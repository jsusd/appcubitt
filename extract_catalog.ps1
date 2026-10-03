Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Xml.Linq

$xlsxPath = "C:\Users\pauli\OneDrive\Desktop\CUBITT 29091111.xlsx"
$tempPath = "$env:TEMP\cubitt_temp.xlsx"
$outImgDir = "c:\Users\pauli\OneDrive\Desktop\Cubitt\images"
if (-not (Test-Path $outImgDir)) { New-Item -ItemType Directory -Path $outImgDir -Force | Out-Null }

$streamIn = [System.IO.File]::Open($xlsxPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$streamOut = [System.IO.File]::Create($tempPath)
$streamIn.CopyTo($streamOut)
$streamIn.Dispose()
$streamOut.Dispose()

$zip = [System.IO.Compression.ZipFile]::OpenRead($tempPath)

function Get-EntryText($entryName) {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq $entryName }
    if ($entry) {
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $t = $reader.ReadToEnd()
        $reader.Dispose()
        return $t
    }
    return $null
}

# 1. Extract all media files to $outImgDir
Write-Host "Extracting media files..."
foreach ($entry in ($zip.Entries | Where-Object { $_.FullName -like "xl/media/*" -and $_.Length -gt 0 })) {
    $targetFile = Join-Path $outImgDir ([System.IO.Path]::GetFileName($entry.FullName))
    if (-not (Test-Path $targetFile)) {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetFile, $true)
    }
}

# 2. Parse Shared Strings
$sstXml = Get-EntryText "xl/sharedStrings.xml"
$sstDoc = [System.Xml.Linq.XDocument]::Parse($sstXml)
$nsMain = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
$sharedStrings = @($sstDoc.Descendants("{$nsMain}si") | ForEach-Object {
    $t = $_.Descendants("{$nsMain}t") | ForEach-Object { $_.Value }
    $t -join ""
})

# 3. Parse drawings rels & drawing1.xml
$relsXml = Get-EntryText "xl/drawings/_rels/drawing1.xml.rels"
$relsDoc = [System.Xml.Linq.XDocument]::Parse($relsXml)
$drawRels = @{}
foreach ($rel in $relsDoc.Root.Elements()) {
    $id = $rel.Attribute('Id').Value
    $target = $rel.Attribute('Target').Value
    $drawRels[$id] = [System.IO.Path]::GetFileName($target)
}

$drawXml = Get-EntryText "xl/drawings/drawing1.xml"
$drawDoc = [System.Xml.Linq.XDocument]::Parse($drawXml)
$xdr = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
$a = "http://schemas.openxmlformats.org/drawingml/2006/main"
$r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

$drawingRowToImg = @{}
foreach ($anc in $drawDoc.Descendants("{$xdr}twoCellAnchor")) {
    $rowIdx = [int]($anc.Element("{$xdr}from").Element("{$xdr}row").Value) + 1
    $blip = $anc.Descendants("{$a}blip") | Select-Object -First 1
    if ($blip) {
        $embed = $blip.Attribute("{$r}embed").Value
        $drawingRowToImg[$rowIdx] = $drawRels[$embed]
    }
}
foreach ($anc in $drawDoc.Descendants("{$xdr}oneCellAnchor")) {
    $rowIdx = [int]($anc.Element("{$xdr}from").Element("{$xdr}row").Value) + 1
    $blip = $anc.Descendants("{$a}blip") | Select-Object -First 1
    if ($blip) {
        $embed = $blip.Attribute("{$r}embed").Value
        $drawingRowToImg[$rowIdx] = $drawRels[$embed]
    }
}

# 4. Parse rich value relationships
$rvRelsXml = Get-EntryText "xl/richData/_rels/richValueRel.xml.rels"
$rvRelsDoc = [System.Xml.Linq.XDocument]::Parse($rvRelsXml)
$rvRelMap = @{}
foreach ($rel in $rvRelsDoc.Root.Elements()) {
    $id = $rel.Attribute('Id').Value
    $target = $rel.Attribute('Target').Value
    $rvRelMap[$id] = [System.IO.Path]::GetFileName($target)
}

$rvRelListXml = Get-EntryText "xl/richData/richValueRel.xml"
$rvRelListDoc = [System.Xml.Linq.XDocument]::Parse($rvRelListXml)
$richRels = "http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel"
$rvRelIndex = @()
foreach ($rel in $rvRelListDoc.Descendants("{$richRels}rel")) {
    $rId = $rel.Attribute("{$r}id").Value
    $rvRelIndex += $rvRelMap[$rId]
}

# Parse rdrichvalue.xml
$rvXml = Get-EntryText "xl/richData/rdrichvalue.xml"
$rvDoc = [System.Xml.Linq.XDocument]::Parse($rvXml)
$nsRv = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"
$rvList = @($rvDoc.Descendants("{$nsRv}rv"))

# Parse metadata.xml
$metaXml = Get-EntryText "xl/metadata.xml"
$metaDoc = [System.Xml.Linq.XDocument]::Parse($metaXml)
$metaRcs = @($metaDoc.Descendants("{$nsMain}rc"))

function Get-RichImageForVm([int]$vm) {
    if ($vm -ge 1 -and $vm -le $metaRcs.Count) {
        $rc = $metaRcs[$vm - 1]
        $rvIdx = [int]($rc.Attribute('v').Value)
        if ($rvIdx -ge 0 -and $rvIdx -lt $rvList.Count) {
            $rv = $rvList[$rvIdx]
            $firstVal = [int]($rv.Elements("{$nsRv}v") | Select-Object -First 1).Value
            if ($firstVal -ge 0 -and $firstVal -lt $rvRelIndex.Count) {
                return $rvRelIndex[$firstVal]
            }
        }
    }
    return $null
}

# 5. Read Sheet1 rows and build product objects
$sheetXml = Get-EntryText "xl/worksheets/sheet1.xml"
$sheetDoc = [System.Xml.Linq.XDocument]::Parse($sheetXml)
$rows = $sheetDoc.Descendants("{$nsMain}row")

$products = @()

foreach ($r in $rows) {
    $rIdx = [int]($r.Attribute('r').Value)
    if ($rIdx -lt 5) { continue } # Skip header rows 1-4

    $cells = $r.Elements("{$nsMain}c")
    $cMap = @{}
    $vmVal = $null

    foreach ($c in $cells) {
        $rRef = $c.Attribute('r').Value
        $colLetter = $rRef -replace '\d+', ''
        $cType = $c.Attribute('t')
        $valElem = $c.Element("{$nsMain}v")
        $val = if ($valElem) { $valElem.Value } else { "" }
        if ($cType -and $cType.Value -eq "s" -and $val -ne "") {
            $val = $sharedStrings[[int]$val]
        }
        $cMap[$colLetter] = $val

        if ($colLetter -eq "B") {
            $vmAttr = $c.Attribute('vm')
            if ($vmAttr) { $vmVal = [int]($vmAttr.Value) }
        }
    }

    $code = if ($cMap.ContainsKey('A')) { $cMap['A'].Trim() } else { "" }
    if ([string]::IsNullOrWhiteSpace($code) -or $code -eq "ARTICULO") { continue }

    $category = if ($cMap.ContainsKey('C')) { $cMap['C'].Trim() } else { "" }
    $status = if ($cMap.ContainsKey('D')) { $cMap['D'].Trim() } else { "DISPONIBLE" }
    $mayor = if ($cMap.ContainsKey('E') -and $cMap['E'] -ne "") { [double]($cMap['E']) } else { 0.0 }
    $pvpTienda = if ($cMap.ContainsKey('F') -and $cMap['F'] -ne "") { [double]($cMap['F']) } else { 0.0 }
    $pvpActual = if ($cMap.ContainsKey('G') -and $cMap['G'] -ne "" -and $cMap['G'] -ne "0") { [double]($cMap['G']) } else { $pvpTienda }

    # Resolve image
    $imgFile = $null
    if ($drawingRowToImg.ContainsKey($rIdx)) {
        $imgFile = $drawingRowToImg[$rIdx]
    } elseif ($vmVal) {
        $imgFile = Get-RichImageForVm $vmVal
    }

    # If still not found, check if code matches an existing webp/jpg in folders
    if (-not $imgFile) {
        $cleanCode = $code -replace '[^a-zA-Z0-9_-]', ''
        $existing = Get-ChildItem -Path "c:\Users\pauli\OneDrive\Desktop\Cubitt" -Recurse -Filter "*$cleanCode*" | Where-Object { $_.Extension -match 'png|webp|jpg' } | Select-Object -First 1
        if ($existing) {
            $destName = "$cleanCode$($existing.Extension)"
            Copy-Item $existing.FullName (Join-Path $outImgDir $destName) -Force
            $imgFile = $destName
        }
    }

    $product = [ordered]@{
        id = $rIdx
        code = $code
        category = $category
        status = $status
        mayor = $mayor
        pvpTienda = $pvpTienda
        pvpActual = $pvpActual
        image = if ($imgFile) { "images/$imgFile" } else { "" }
    }
    $products += $product
}

$zip.Dispose()
Remove-Item $tempPath -Force

Write-Host "Total products extracted: $($products.Count)"

# Also create copy with code-based image names for easier reference
foreach ($p in $products) {
    if ($p.image -ne "") {
        $srcFile = Join-Path "c:\Users\pauli\OneDrive\Desktop\Cubitt" $p.image
        if (Test-Path $srcFile) {
            $ext = [System.IO.Path]::GetExtension($srcFile)
            $cleanCode = $p.code -replace '[^a-zA-Z0-9_-]', '_'
            $targetCodeFile = Join-Path $outImgDir "$cleanCode$ext"
            if (-not (Test-Path $targetCodeFile)) {
                Copy-Item $srcFile $targetCodeFile -Force
            }
            $p.image = "images/$cleanCode$ext"
        }
    }
}

# Save JSON
$json = $products | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("c:\Users\pauli\OneDrive\Desktop\Cubitt\products.json", $json, [System.Text.Encoding]::UTF8)

# Save JS for direct browser loading without CORS restriction on file://
$js = "const CUBITT_PRODUCTS = " + $json + ";"
[System.IO.File]::WriteAllText("c:\Users\pauli\OneDrive\Desktop\Cubitt\products.js", $js, [System.Text.Encoding]::UTF8)

Write-Host "Catalog saved to products.json and products.js successfully!"
Write-Host "Sample product:"
$products | Select-Object -First 3 | Format-Table -AutoSize

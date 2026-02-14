# apply-security.ps1 — Embed fonts + apply security fixes to index.html
# Run from d:\Desktop\hd

$file = "d:\Desktop\hd\index.html"
$content = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)

# --- 1. Read base64 font data ---
$b64_300 = [IO.File]::ReadAllText("d:\Desktop\hd\fonts\lato-300.b64").Trim()
$b64_400 = [IO.File]::ReadAllText("d:\Desktop\hd\fonts\lato-400.b64").Trim()
$b64_700 = [IO.File]::ReadAllText("d:\Desktop\hd\fonts\lato-700.b64").Trim()
$b64_900 = [IO.File]::ReadAllText("d:\Desktop\hd\fonts\lato-900.b64").Trim()

# --- 2. Build embedded @font-face block ---
$fontFaces = @"
        /* Embedded Lato Font (self-hosted, no external requests) */
        @font-face {
            font-family: 'Lato';
            font-style: normal;
            font-weight: 300;
            font-display: swap;
            src: url(data:font/truetype;base64,$b64_300) format('truetype');
        }
        @font-face {
            font-family: 'Lato';
            font-style: normal;
            font-weight: 400;
            font-display: swap;
            src: url(data:font/truetype;base64,$b64_400) format('truetype');
        }
        @font-face {
            font-family: 'Lato';
            font-style: normal;
            font-weight: 700;
            font-display: swap;
            src: url(data:font/truetype;base64,$b64_700) format('truetype');
        }
        @font-face {
            font-family: 'Lato';
            font-style: normal;
            font-weight: 900;
            font-display: swap;
            src: url(data:font/truetype;base64,$b64_900) format('truetype');
        }

"@

# --- 3. Replace Google Fonts <link> with nothing (remove external dependency) ---
$content = $content -replace '    <link href="https://fonts.googleapis.com/css2\?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">\r?\n', ''

# --- 4. Insert @font-face right after <style> opening ---
$content = $content -replace '(<style>\r?\n)', "`$1$fontFaces"

# --- 5. Fix duplicate </head> tag (line 1172) ---
$content = $content -replace '(</head>\r?\n)</head>', '$1'

# --- 6. Add security meta tags after <meta name="viewport"...> ---
$securityMeta = @'
    <meta http-equiv="X-Content-Type-Options" content="nosniff">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=()">
'@

$content = $content -replace '(<meta name="viewport"[^>]+>\r?\n)', "`$1$securityMeta`r`n"

# --- 7. Remove developer email from HTML comment ---
$content = $content -replace 'MADE BY 3DSITER@GMAIL.COM', 'MADE WITH LOVE'

# --- 8. Write back ---
[IO.File]::WriteAllText($file, $content, [Text.Encoding]::UTF8)

Write-Host "Done! Security fixes and font embedding applied to index.html"
Write-Host "External dependencies removed: Google Fonts CDN"
Write-Host "Security headers added: X-Content-Type-Options, Referrer-Policy, Permissions-Policy"

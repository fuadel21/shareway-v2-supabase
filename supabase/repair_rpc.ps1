$path = "c:\shareway v2 supabase\supabase\rpc_functions.sql"
$content = [System.IO.File]::ReadAllText($path)
[System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)

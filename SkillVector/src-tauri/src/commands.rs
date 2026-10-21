use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// Writes an exported file into the user's Downloads folder (webview downloads are
/// unavailable inside Tauri). Picks a unique name and returns the final path.
#[tauri::command]
pub fn save_to_downloads(filename: String, data_base64: String) -> Result<String, String> {
    let bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot locate home directory".to_string())?;
    let dir = std::path::Path::new(&home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Strip any path components from the requested name
    let safe: String = filename
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c })
        .collect();
    let path = std::path::Path::new(&safe);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("export").to_string();
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    let mut target = dir.join(&safe);
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

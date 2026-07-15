use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// 文件树节点
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
    pub file_size: u64,
    pub modified: u64,
    pub file_type: String, // "html", "md", "folder", "other"
}

/// 判断文件类型
fn get_file_type(name: &str) -> String {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "html".to_string(),
        "md" | "markdown" => "md".to_string(),
        _ => "other".to_string(),
    }
}

/// 判断是否为支持的文档文件
fn is_supported_file(name: &str) -> bool {
    let ft = get_file_type(name);
    ft == "html" || ft == "md"
}

/// 递归构建目录树，包含子目录和 .html/.htm/.md 文件
fn build_tree(path: &Path) -> Vec<TreeNode> {
    let mut nodes = Vec::new();
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return nodes,
    };

    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut files: Vec<PathBuf> = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            dirs.push(entry_path);
        } else {
            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if is_supported_file(&name) {
                files.push(entry_path);
            }
        }
    }

    dirs.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    for dir_path in dirs {
        let children = build_tree(&dir_path);
        let modified = fs::metadata(&dir_path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let name = dir_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        nodes.push(TreeNode {
            name,
            path: dir_path.to_string_lossy().to_string(),
            is_dir: true,
            children,
            file_size: 0,
            modified,
            file_type: "folder".to_string(),
        });
    }

    for file_path in files {
        let metadata = fs::metadata(&file_path);
        let file_size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = metadata
            .as_ref()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        nodes.push(TreeNode {
            name: name.clone(),
            path: file_path.to_string_lossy().to_string(),
            is_dir: false,
            children: Vec::new(),
            file_size,
            modified,
            file_type: get_file_type(&name),
        });
    }

    nodes
}

/// 列出指定路径下的目录树
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<TreeNode>, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("不是目录: {}", path.display()));
    }
    Ok(build_tree(path))
}

/// 获取应用数据目录（Tauri 标准：C:\Users\用户名\AppData\Roaming\ReportManager）
fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("无法获取 AppData 目录: {}", e))?;
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| format!("创建 AppData 目录失败: {}", e))?;
    }
    Ok(data_dir)
}

/// 获取默认文档目录（AppData 下的 documents 文件夹）
#[tauri::command]
fn get_default_documents_dir(app: AppHandle) -> Result<String, String> {
    let data_dir = get_app_data_dir(&app)?;
    let docs_dir = data_dir.join("documents");
    if !docs_dir.exists() {
        fs::create_dir_all(&docs_dir).map_err(|e| format!("创建文档目录失败: {}", e))?;
    }
    Ok(docs_dir.to_string_lossy().to_string())
}

/// 获取配置文件路径（AppData 目录下的 config.json）
fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = get_app_data_dir(app)?;
    Ok(data_dir.join("config.json"))
}

/// 保存配置到磁盘文件
#[tauri::command]
fn save_config(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let config_path = get_config_path(&app)?;
    
    // 读取现有配置（如果存在）
    let mut config: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("读取配置失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    
    // 更新配置
    if let Some(obj) = config.as_object_mut() {
        obj.insert(key, serde_json::Value::String(value));
    }
    
    // 写入文件
    let json_str = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(&config_path, json_str)
        .map_err(|e| format!("写入配置失败: {}", e))?;
    
    Ok(())
}

/// 从磁盘文件读取配置
#[tauri::command]
fn load_config(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let config_path = get_config_path(&app)?;
    
    if !config_path.exists() {
        return Ok(None);
    }
    
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置失败: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置失败: {}", e))?;
    
    if let Some(val) = config.get(&key) {
        if let Some(s) = val.as_str() {
            return Ok(Some(s.to_string()));
        }
    }
    
    Ok(None)
}

/// 读取文件内容
#[tauri::command]
fn read_html_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
}

/// 打开文件夹选择对话框
#[tauri::command]
fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("选择文档根目录")
        .pick_folder(move |result| {
            let _ = tx.send(result);
        });
    let result = rx.recv().map_err(|e| format!("对话框错误: {}", e))?;
    Ok(result.and_then(|p| {
        p.as_path().map(|p| p.to_string_lossy().to_string())
    }))
}

/// 创建文件夹
#[tauri::command]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    let path = Path::new(&parent).join(&name);
    if path.exists() {
        return Err(format!("路径已存在: {}", path.display()));
    }
    fs::create_dir(&path).map_err(|e| format!("创建文件夹失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// 通过字节数据写入文件（用于 OS 文件拖入，HTML5 API 无法获取文件路径）
#[tauri::command]
fn write_file_bytes(dest_dir: String, filename: String, data: Vec<u8>) -> Result<String, String> {
    let dest_dir = Path::new(&dest_dir);
    if !dest_dir.is_dir() {
        return Err(format!("目标不是目录: {}", dest_dir.display()));
    }
    let dest_path = dest_dir.join(&filename);
    // 重名时添加数字后缀
    let mut final_path = dest_path.clone();
    let mut counter = 1;
    while final_path.exists() {
        let stem = Path::new(&filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| filename.clone());
        let ext = Path::new(&filename)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        final_path = dest_dir.join(format!("{}_{}{}", stem, counter, ext));
        counter += 1;
    }
    fs::write(&final_path, &data).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(final_path.to_string_lossy().to_string())
}

/// 创建文档文件（HTML 或 Markdown）
#[tauri::command]
fn create_html_file(parent: String, name: String) -> Result<String, String> {
    let mut filename = name;
    if !filename.ends_with(".html") && !filename.ends_with(".htm") && !filename.ends_with(".md") {
        filename.push_str(".html");
    }
    let path = Path::new(&parent).join(&filename);
    if path.exists() {
        return Err(format!("文件已存在: {}", path.display()));
    }
    let template = if filename.ends_with(".md") {
        format!("# {}\n\n在此编辑 Markdown 内容...\n", filename)
    } else {
        format!(
            "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>{}</title>\n</head>\n<body>\n  <h1>{}</h1>\n  <p>在此编辑内容...</p>\n</body>\n</html>",
            filename, filename
        )
    };
    fs::write(&path, template).map_err(|e| format!("创建文件失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// 删除文件或文件夹
#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("删除文件夹失败: {}", e))
    } else {
        fs::remove_file(path).map_err(|e| format!("删除文件失败: {}", e))
    }
}

/// 重命名文件或文件夹
#[tauri::command]
fn rename_path(path: String, new_name: String) -> Result<String, String> {
    let path = Path::new(&path);
    let parent = path.parent().ok_or("无法获取父目录")?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("目标路径已存在: {}", new_path.display()));
    }
    fs::rename(path, &new_path).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(new_path.to_string_lossy().to_string())
}

/// 移动文件到另一目录
#[tauri::command]
fn move_path(src: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&src);
    let dest_dir = Path::new(&dest_dir);
    if !src.exists() {
        return Err(format!("源路径不存在: {}", src.display()));
    }
    if !dest_dir.is_dir() {
        return Err(format!("目标不是目录: {}", dest_dir.display()));
    }
    let file_name = src
        .file_name()
        .ok_or("无法获取文件名")?
        .to_string_lossy()
        .to_string();
    let dest_path = dest_dir.join(&file_name);
    if dest_path.exists() {
        return Err(format!("目标路径已存在同名文件: {}", dest_path.display()));
    }
    fs::rename(src, &dest_path).map_err(|e| format!("移动失败: {}", e))?;
    Ok(dest_path.to_string_lossy().to_string())
}

/// 递归复制目录
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("创建目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let src_path = entry.path();
        let file_name = entry.file_name();
        let dest_path = dest.join(&file_name);
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path).map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

/// 复制文件或文件夹到目标目录（支持外部文件拖入）
#[tauri::command]
fn copy_file(src: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&src);
    let dest_dir = Path::new(&dest_dir);
    if !src.exists() {
        return Err(format!("源路径不存在: {}", src.display()));
    }
    if !dest_dir.is_dir() {
        return Err(format!("目标不是目录: {}", dest_dir.display()));
    }
    let file_name = src
        .file_name()
        .ok_or("无法获取文件名")?
        .to_string_lossy()
        .to_string();
    let dest_path = dest_dir.join(&file_name);
    // 如果目标已存在，添加数字后缀
    let mut dest_path = dest_path.clone();
    let mut counter = 1;
    while dest_path.exists() {
        let stem = Path::new(&file_name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.clone());
        let ext = Path::new(&file_name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        dest_path = dest_dir.join(format!("{}_{}{}", stem, counter, ext));
        counter += 1;
    }
    if src.is_dir() {
        copy_dir_recursive(src, &dest_path)?;
    } else {
        fs::copy(src, &dest_path).map_err(|e| format!("复制文件失败: {}", e))?;
    }
    Ok(dest_path.to_string_lossy().to_string())
}

/// 获取文件信息
#[tauri::command]
fn get_file_info(path: String) -> Result<TreeNode, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }
    let metadata = fs::metadata(path).map_err(|e| format!("获取文件信息失败: {}", e))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(TreeNode {
        name: name.clone(),
        path: path.to_string_lossy().to_string(),
        is_dir: path.is_dir(),
        children: Vec::new(),
        file_size: metadata.len(),
        modified,
        file_type: if path.is_dir() {
            "folder".to_string()
        } else {
            get_file_type(&name)
        },
    })
}

/// 判断路径是否存在
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 读取文件内容为 Base64（用于内联外部资源：CSS、图片等）
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    // 手动 Base64 编码（避免额外依赖）
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((n >> 18) & 63) as usize] as char);
        result.push(CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((n >> 6) & 63) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(n & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    Ok(result)
}

/// 获取文件的 MIME 类型
fn get_mime_type(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "css" => "text/css".to_string(),
        "js" => "application/javascript".to_string(),
        "png" => "image/png".to_string(),
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "gif" => "image/gif".to_string(),
        "svg" => "image/svg+xml".to_string(),
        "webp" => "image/webp".to_string(),
        "ico" => "image/x-icon".to_string(),
        "woff" => "font/woff".to_string(),
        "woff2" => "font/woff2".to_string(),
        "ttf" => "font/ttf".to_string(),
        "eot" => "application/vnd.ms-fontobject".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

/// 读取文件并返回 data URI（mime;base64,...）
#[tauri::command]
fn read_file_data_uri(path: String) -> Result<String, String> {
    let mime = get_mime_type(&path);
    let base64 = read_file_base64(path)?;
    Ok(format!("data:{};base64,{}", mime, base64))
}

/// 在系统资源管理器中打开路径（文件则选中，文件夹则打开）
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }
    #[cfg(target_os = "windows")]
    {
        // 使用 Windows API ShellExecuteW 打开资源管理器
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        
        let operation: Vec<u16> = OsStr::new("open")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let file: Vec<u16> = OsStr::new("explorer.exe")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        
        let params = if path.is_dir() {
            format!("\"{}\"", path.display())
        } else {
            // /select 选中文件
            format!("/select,\"{}\"", path.display())
        };
        let params_wide: Vec<u16> = OsStr::new(&params)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                operation: *const u16,
                file: *const u16,
                params: *const u16,
                directory: *const u16,
                show_cmd: i32,
            ) -> *mut std::ffi::c_void;
        }

        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                params_wide.as_ptr(),
                std::ptr::null(),
                1, // SW_SHOWNORMAL
            )
        };

        if result as isize <= 32 {
            return Err(format!("打开资源管理器失败 (ShellExecuteW 返回 {})", result as isize));
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path.parent().unwrap_or(path))
            .spawn()
            .map_err(|e| format!("打开 Finder 失败: {}", e))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path.parent().unwrap_or(path))
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_directory,
            get_default_documents_dir,
            save_config,
            load_config,
            read_html_file,
            pick_folder,
            create_folder,
            write_file_bytes,
            create_html_file,
            delete_path,
            rename_path,
            move_path,
            copy_file,
            get_file_info,
            path_exists,
            open_in_explorer,
            read_file_base64,
            read_file_data_uri,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

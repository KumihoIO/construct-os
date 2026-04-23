//! Mobile entry point for Construct Desktop (iOS/Android).

#[tauri::mobile_entry_point]
fn main() {
    construct_desktop::run();
}

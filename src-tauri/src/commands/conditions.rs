use crate::condition;
use crate::config::Condition;

/// Parse condition text syntax into a Condition tree.
/// Returns the parsed condition, or an error with a message.
#[tauri::command]
pub fn parse_condition_text(text: String) -> Result<Condition, String> {
    condition::parse(&text)
}

/// Serialize a Condition tree back to text syntax.
#[tauri::command]
pub fn condition_to_text(cond: Condition) -> Result<String, String> {
    Ok(condition::to_text(&cond))
}

/// Validate condition text and return any error.
#[tauri::command]
pub fn validate_condition_text(text: String) -> Result<(), String> {
    condition::validate_text(&text)
}

/// Test a condition against a sample filename (for the UI preview).
#[tauri::command]
pub fn test_condition(cond: Condition, file_name: String) -> Result<bool, String> {
    Ok(condition::evaluate(&cond, &file_name))
}

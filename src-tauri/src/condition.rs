//! Condition evaluation and text-syntax parser/serializer.
//!
//! ## Text Syntax (wildcard-style, case-insensitive)
//!
//! Simple patterns:
//!   `*.pdf`           — glob, matches files ending in .pdf
//!   `invoice*`        — glob, matches files starting with "invoice"
//!   `*report*`        — glob, contains "report"
//!   `/^IMG_\d+/`      — regex (wrapped in `/`)
//!
//! Combinators:
//!   `*.pdf AND *invoice*`               — both must match
//!   `*.jpg OR *.png OR *.gif`           — any must match
//!   `NOT *.tmp`                         — negation
//!   `(*.pdf OR *.docx) AND *report*`    — grouping with parens
//!   `*`                                 — matches everything (Always)

use regex::Regex;

use crate::config::Condition;

// ── Evaluation ──────────────────────────────────────────────

/// Test whether a filename matches a condition tree.
pub fn evaluate(condition: &Condition, file_name: &str) -> bool {
    match condition {
        Condition::Glob { pattern } => glob_match(pattern, file_name),
        Condition::Regex { pattern } => {
            Regex::new(pattern)
                .map(|re| re.is_match(file_name))
                .unwrap_or(false)
        }
        Condition::And { conditions } => {
            conditions.iter().all(|c| evaluate(c, file_name))
        }
        Condition::Or { conditions } => {
            conditions.iter().any(|c| evaluate(c, file_name))
        }
        Condition::Not { condition } => !evaluate(condition, file_name),
        Condition::Always => true,
    }
}

/// Simple glob matching: `*` = any chars, `?` = single char. Case-insensitive.
fn glob_match(pattern: &str, text: &str) -> bool {
    let pat = pattern.to_lowercase();
    let txt = text.to_lowercase();
    glob_match_impl(pat.as_bytes(), txt.as_bytes())
}

fn glob_match_impl(pat: &[u8], txt: &[u8]) -> bool {
    let mut px = 0;
    let mut tx = 0;
    let mut star_px = usize::MAX;
    let mut star_tx = 0;

    while tx < txt.len() {
        if px < pat.len() && (pat[px] == b'?' || pat[px] == txt[tx]) {
            px += 1;
            tx += 1;
        } else if px < pat.len() && pat[px] == b'*' {
            star_px = px;
            star_tx = tx;
            px += 1;
        } else if star_px != usize::MAX {
            px = star_px + 1;
            star_tx += 1;
            tx = star_tx;
        } else {
            return false;
        }
    }

    while px < pat.len() && pat[px] == b'*' {
        px += 1;
    }

    px == pat.len()
}

// ── Text → Condition (Parser) ───────────────────────────────

/// Parse a text-syntax string into a Condition tree.
/// Returns Err with a human-readable message on parse failure.
pub fn parse(input: &str) -> Result<Condition, String> {
    let input = input.trim();
    if input.is_empty() || input == "*" {
        return Ok(Condition::Always);
    }

    let tokens = tokenize(input)?;
    let (cond, rest) = parse_or(&tokens)?;
    if !rest.is_empty() {
        return Err(format!("Unexpected token: {:?}", rest[0]));
    }
    Ok(cond)
}

/// Serialize a Condition tree back to text syntax.
pub fn to_text(cond: &Condition) -> String {
    match cond {
        Condition::Always => "*".to_string(),
        Condition::Glob { pattern } => pattern.clone(),
        Condition::Regex { pattern } => format!("/{}/", pattern),
        Condition::Not { condition } => {
            let inner = to_text(condition);
            if needs_parens(condition) {
                format!("NOT ({})", inner)
            } else {
                format!("NOT {}", inner)
            }
        }
        Condition::And { conditions } => {
            conditions
                .iter()
                .map(|c| {
                    if matches!(c, Condition::Or { .. }) {
                        format!("({})", to_text(c))
                    } else {
                        to_text(c)
                    }
                })
                .collect::<Vec<_>>()
                .join(" AND ")
        }
        Condition::Or { conditions } => {
            conditions
                .iter()
                .map(|c| to_text(c))
                .collect::<Vec<_>>()
                .join(" OR ")
        }
    }
}

fn needs_parens(cond: &Condition) -> bool {
    matches!(cond, Condition::And { .. } | Condition::Or { .. })
}

// ── Tokenizer ───────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Token {
    And,
    Or,
    Not,
    LParen,
    RParen,
    Glob(String),
    Regex(String),
}

fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Skip whitespace
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }

        // Parentheses
        if chars[i] == '(' {
            tokens.push(Token::LParen);
            i += 1;
            continue;
        }
        if chars[i] == ')' {
            tokens.push(Token::RParen);
            i += 1;
            continue;
        }

        // Regex literal: /pattern/
        if chars[i] == '/' {
            i += 1;
            let start = i;
            while i < chars.len() && chars[i] != '/' {
                i += 1;
            }
            if i >= chars.len() {
                return Err("Unterminated regex: missing closing /".to_string());
            }
            let pattern: String = chars[start..i].iter().collect();
            tokens.push(Token::Regex(pattern));
            i += 1; // skip closing /
            continue;
        }

        // Keywords: AND, OR, NOT — must be followed by whitespace or paren or end
        if i + 3 <= chars.len() {
            let word3: String = chars[i..i + 3].iter().collect();
            if word3.eq_ignore_ascii_case("AND") && is_word_boundary(&chars, i + 3) {
                tokens.push(Token::And);
                i += 3;
                continue;
            }
            if word3.eq_ignore_ascii_case("NOT") && is_word_boundary(&chars, i + 3) {
                tokens.push(Token::Not);
                i += 3;
                continue;
            }
        }
        if i + 2 <= chars.len() {
            let word2: String = chars[i..i + 2].iter().collect();
            if word2.eq_ignore_ascii_case("OR") && is_word_boundary(&chars, i + 2) {
                tokens.push(Token::Or);
                i += 2;
                continue;
            }
        }

        // Glob pattern — collect until whitespace, paren, or end
        let start = i;
        while i < chars.len()
            && !chars[i].is_whitespace()
            && chars[i] != '('
            && chars[i] != ')'
        {
            i += 1;
        }
        let glob: String = chars[start..i].iter().collect();
        if !glob.is_empty() {
            tokens.push(Token::Glob(glob));
        }
    }

    Ok(tokens)
}

fn is_word_boundary(chars: &[char], pos: usize) -> bool {
    pos >= chars.len() || chars[pos].is_whitespace() || chars[pos] == '(' || chars[pos] == ')'
}

// ── Recursive Descent Parser ────────────────────────────────
// Grammar:
//   expr     = or_expr
//   or_expr  = and_expr ("OR" and_expr)*
//   and_expr = not_expr ("AND" not_expr)*
//   not_expr = "NOT" not_expr | primary
//   primary  = "(" or_expr ")" | glob | regex

fn parse_or<'a>(tokens: &'a [Token]) -> Result<(Condition, &'a [Token]), String> {
    let (mut left, mut rest) = parse_and(tokens)?;
    let mut parts = vec![left];

    while !rest.is_empty() && rest[0] == Token::Or {
        let (right, r) = parse_and(&rest[1..])?;
        parts.push(right);
        rest = r;
    }

    if parts.len() == 1 {
        Ok((parts.remove(0), rest))
    } else {
        Ok((Condition::Or { conditions: parts }, rest))
    }
}

fn parse_and<'a>(tokens: &'a [Token]) -> Result<(Condition, &'a [Token]), String> {
    let (mut left, mut rest) = parse_not(tokens)?;
    let mut parts = vec![left];

    while !rest.is_empty() && rest[0] == Token::And {
        let (right, r) = parse_not(&rest[1..])?;
        parts.push(right);
        rest = r;
    }

    if parts.len() == 1 {
        Ok((parts.remove(0), rest))
    } else {
        Ok((Condition::And { conditions: parts }, rest))
    }
}

fn parse_not<'a>(tokens: &'a [Token]) -> Result<(Condition, &'a [Token]), String> {
    if tokens.is_empty() {
        return Err("Unexpected end of expression".to_string());
    }

    if tokens[0] == Token::Not {
        let (inner, rest) = parse_not(&tokens[1..])?;
        Ok((
            Condition::Not {
                condition: Box::new(inner),
            },
            rest,
        ))
    } else {
        parse_primary(tokens)
    }
}

fn parse_primary<'a>(tokens: &'a [Token]) -> Result<(Condition, &'a [Token]), String> {
    if tokens.is_empty() {
        return Err("Unexpected end of expression".to_string());
    }

    match &tokens[0] {
        Token::LParen => {
            let (cond, rest) = parse_or(&tokens[1..])?;
            if rest.is_empty() || rest[0] != Token::RParen {
                return Err("Missing closing parenthesis".to_string());
            }
            Ok((cond, &rest[1..]))
        }
        Token::Glob(pattern) => {
            if pattern == "*" {
                Ok((Condition::Always, &tokens[1..]))
            } else {
                Ok((
                    Condition::Glob {
                        pattern: pattern.clone(),
                    },
                    &tokens[1..],
                ))
            }
        }
        Token::Regex(pattern) => Ok((
            Condition::Regex {
                pattern: pattern.clone(),
            },
            &tokens[1..],
        )),
        other => Err(format!("Unexpected token: {:?}", other)),
    }
}

// ── Validate ────────────────────────────────────────────────

/// Validate a condition text string. Returns Ok(()) or Err with message.
pub fn validate_text(input: &str) -> Result<(), String> {
    parse(input).map(|_| ())
}

/// Validate a condition tree (check regex patterns are valid, etc.)
pub fn validate_condition(cond: &Condition) -> Result<(), String> {
    match cond {
        Condition::Regex { pattern } => {
            Regex::new(pattern).map_err(|e| format!("Invalid regex: {}", e))?;
            Ok(())
        }
        Condition::And { conditions } | Condition::Or { conditions } => {
            for c in conditions {
                validate_condition(c)?;
            }
            Ok(())
        }
        Condition::Not { condition } => validate_condition(condition),
        _ => Ok(()),
    }
}

// ── Tests ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match() {
        assert!(glob_match("*.pdf", "report.pdf"));
        assert!(glob_match("*.PDF", "report.pdf")); // case-insensitive
        assert!(!glob_match("*.pdf", "report.doc"));
        assert!(glob_match("invoice*", "invoice_2026.pdf"));
        assert!(glob_match("*report*", "annual_report_v2.xlsx"));
        assert!(glob_match("?est.txt", "test.txt"));
        assert!(!glob_match("?est.txt", "arest.txt"));
        assert!(glob_match("*", "anything.xyz"));
    }

    #[test]
    fn test_parse_simple() {
        let c = parse("*.pdf").unwrap();
        assert!(evaluate(&c, "report.pdf"));
        assert!(!evaluate(&c, "report.doc"));
    }

    #[test]
    fn test_parse_and() {
        let c = parse("*.pdf AND *invoice*").unwrap();
        assert!(evaluate(&c, "invoice_2026.pdf"));
        assert!(!evaluate(&c, "report.pdf"));
        assert!(!evaluate(&c, "invoice.doc"));
    }

    #[test]
    fn test_parse_or() {
        let c = parse("*.jpg OR *.png OR *.gif").unwrap();
        assert!(evaluate(&c, "photo.jpg"));
        assert!(evaluate(&c, "icon.png"));
        assert!(!evaluate(&c, "doc.pdf"));
    }

    #[test]
    fn test_parse_not() {
        let c = parse("NOT *.tmp").unwrap();
        assert!(evaluate(&c, "report.pdf"));
        assert!(!evaluate(&c, "cache.tmp"));
    }

    #[test]
    fn test_parse_grouped() {
        let c = parse("(*.pdf OR *.docx) AND *report*").unwrap();
        assert!(evaluate(&c, "annual_report.pdf"));
        assert!(evaluate(&c, "report_q1.docx"));
        assert!(!evaluate(&c, "annual_report.xlsx"));
        assert!(!evaluate(&c, "invoice.pdf"));
    }

    #[test]
    fn test_parse_regex() {
        let c = parse(r"/^IMG_\d+\.jpg$/").unwrap();
        assert!(evaluate(&c, "IMG_1234.jpg"));
        assert!(!evaluate(&c, "photo.jpg"));
    }

    #[test]
    fn test_roundtrip() {
        let cases = vec![
            "*.pdf",
            "*.pdf AND *invoice*",
            "*.jpg OR *.png",
            "NOT *.tmp",
            "(*.pdf OR *.docx) AND *report*",
        ];
        for input in cases {
            let cond = parse(input).unwrap();
            let text = to_text(&cond);
            let cond2 = parse(&text).unwrap();
            // Verify they evaluate the same
            assert_eq!(
                evaluate(&cond, "test_invoice.pdf"),
                evaluate(&cond2, "test_invoice.pdf"),
                "Roundtrip failed for: {}",
                input
            );
        }
    }

    #[test]
    fn test_always() {
        let c = parse("*").unwrap();
        assert!(matches!(c, Condition::Always));
        assert!(evaluate(&c, "anything"));

        let c = parse("").unwrap();
        assert!(matches!(c, Condition::Always));
    }
}

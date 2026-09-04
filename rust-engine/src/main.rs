use life_sim_engine::{MachineSession, ResponseEnvelope, MAX_COMMAND_BYTES, RESPONSE_SCHEMA};
use std::env;
use std::io::{self, BufRead, Read, Write};

fn write_response(
    output: &mut impl Write,
    response: &ResponseEnvelope,
    pretty: bool,
) -> Result<(), String> {
    let encoded = if pretty {
        serde_json::to_string_pretty(response)
    } else {
        serde_json::to_string(response)
    }
    .map_err(|cause| format!("failed to encode response: {cause}"))?;
    writeln!(output, "{encoded}").map_err(|cause| format!("failed to write response: {cause}"))
}

fn error_response(code: &'static str, message: String) -> ResponseEnvelope {
    ResponseEnvelope {
        schema: RESPONSE_SCHEMA,
        request_id: None,
        ok: false,
        result: None,
        error: Some(life_sim_engine::ErrorBody { code, message }),
    }
}

enum BoundedLine {
    Eof,
    Line(Vec<u8>),
    TooLarge,
}

fn read_bounded_line(reader: &mut impl BufRead, maximum: usize) -> io::Result<BoundedLine> {
    let mut line = Vec::new();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if oversized {
                Ok(BoundedLine::TooLarge)
            } else if line.is_empty() {
                Ok(BoundedLine::Eof)
            } else {
                Ok(BoundedLine::Line(line))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        let content_end = newline.unwrap_or(available.len());
        if !oversized {
            if line.len().saturating_add(content_end) > maximum {
                oversized = true;
                line.clear();
            } else {
                line.extend_from_slice(&available[..content_end]);
            }
        }
        reader.consume(consumed);
        if newline.is_some() {
            return if oversized {
                Ok(BoundedLine::TooLarge)
            } else {
                Ok(BoundedLine::Line(line))
            };
        }
    }
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    if arguments
        .iter()
        .any(|argument| argument == "--help" || argument == "-h")
    {
        eprintln!(
            "life-sim-engine [--ndjson] [--pretty] [--state-file PATH]\n\nReads JSON commands from stdin and writes JSON responses to stdout. Durable state is opt-in through --state-file or LIFE_SIM_STATE_FILE."
        );
        return;
    }
    let mut ndjson = false;
    let mut pretty = false;
    let mut state_file = None;
    let mut index = 0;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--ndjson" => ndjson = true,
            "--pretty" => pretty = true,
            "--state-file" => {
                index += 1;
                let Some(path) = arguments.get(index) else {
                    eprintln!("--state-file requires a path");
                    std::process::exit(2);
                };
                state_file = Some(path.clone());
            }
            _ => {
                eprintln!("unknown argument {}; use --help", arguments[index]);
                std::process::exit(2);
            }
        }
        index += 1;
    }
    if state_file.is_none() {
        state_file = env::var("LIFE_SIM_STATE_FILE").ok();
    }

    let stdout = io::stdout();
    let mut output = stdout.lock();
    let mut session = match state_file {
        Some(path) => MachineSession::with_state_file(path).unwrap_or_else(|cause| {
            eprintln!("failed to initialize durable session: {cause}");
            std::process::exit(1);
        }),
        None => MachineSession::default(),
    };
    if ndjson {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            let response = match read_bounded_line(&mut input, MAX_COMMAND_BYTES) {
                Ok(BoundedLine::Eof) => break,
                Ok(BoundedLine::Line(line)) if line.iter().all(u8::is_ascii_whitespace) => continue,
                Ok(BoundedLine::Line(line)) => match String::from_utf8(line) {
                    Ok(line) => session.parse_and_execute(&line),
                    Err(cause) => error_response("invalid_json", cause.to_string()),
                },
                Ok(BoundedLine::TooLarge) => error_response(
                    "request_too_large",
                    format!("command exceeds {MAX_COMMAND_BYTES} bytes"),
                ),
                Err(cause) => error_response("io_error", format!("failed to read stdin: {cause}")),
            };
            if let Err(cause) = write_response(&mut output, &response, pretty) {
                eprintln!("{cause}");
                std::process::exit(1);
            }
        }
    } else {
        let mut input = Vec::new();
        let response = match io::stdin()
            .take(MAX_COMMAND_BYTES.saturating_add(1) as u64)
            .read_to_end(&mut input)
        {
            Ok(_) if input.len() > MAX_COMMAND_BYTES => error_response(
                "request_too_large",
                format!("command exceeds {MAX_COMMAND_BYTES} bytes"),
            ),
            Ok(_) => match String::from_utf8(input) {
                Ok(input) => session.parse_and_execute(&input),
                Err(cause) => error_response("invalid_json", cause.to_string()),
            },
            Err(cause) => error_response("io_error", format!("failed to read stdin: {cause}")),
        };
        if let Err(cause) = write_response(&mut output, &response, pretty) {
            eprintln!("{cause}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn bounded_line_discards_an_oversized_command_and_resumes() {
        let mut reader = Cursor::new(b"123456\n{}\n".to_vec());
        assert!(matches!(
            read_bounded_line(&mut reader, 5).unwrap(),
            BoundedLine::TooLarge
        ));
        match read_bounded_line(&mut reader, 5).unwrap() {
            BoundedLine::Line(line) => assert_eq!(line, b"{}"),
            _ => panic!("expected the command after the oversized line"),
        }
    }
}

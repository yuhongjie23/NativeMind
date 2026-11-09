use crate::commands::Backend;
use serde_json::{json, Value};

pub async fn respond(backend: &mut Backend, frame: &str) -> Option<Value> {
    let req: Value = match serde_json::from_str(frame) {
        Ok(value) => value,
        Err(_) => {
            return Some(
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}}),
            )
        }
    };
    let id = req.get("id")?.clone(); // JSON-RPC notifications must not receive replies.
    if req.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32600,"message":"Invalid request"}}),
        );
    }
    let result = match req.get("method").and_then(Value::as_str) {
        Some("initialize") => {
            json!({"protocolVersion":"2.0","serverInfo":{"name":"nativemind-native","version":"0.1.0"},"capabilities":{}})
        }
        Some("describe") => json!({
            "name":"tool-dev-nativemind", "version":"0.1.0",
            "description":"LOCAL DEVELOPMENT ONLY. NativeMind desktop SQLite, Ollama and document parsers. Do not publish.",
            "tools":[{"name":"native_command","description":"Private UI transport for the local development harness. Not an agent tool.","timeout":300,
                "parameters":[{"name":"command","type":"string","required":true},{"name":"args","type":"object","required":true},{"name":"clientId","type":"string","required":true},{"name":"leaseToken","type":"string","required":false}]}]
        }),
        Some("health") => json!({"status":"ready"}),
        Some("invoke") if req["params"]["tool"] == "native_command" => {
            match backend.invoke(&req["params"]["arguments"]).await {
                // Anna accepts an object payload; arrays/scalars otherwise become {}.
                Ok(data) => json!({"success":true,"data":{"value":data}}),
                Err(error) => json!({"success":false,"error":error.to_string()}),
            }
        }
        _ => {
            return Some(
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Unknown method"}}),
            )
        }
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}

//! Restrict the development SQL bridge to its opened database.
//! This is filesystem confinement, not user authentication or a write-confirmation gate.
use rusqlite::{
    hooks::{AuthAction, AuthContext, Authorization},
    Connection,
};

pub fn install(connection: &Connection) {
    // Install only after loading the bundled extension from a trusted fixed path.
    connection.authorizer(Some(authorize));
}

fn authorize(context: AuthContext<'_>) -> Authorization {
    use AuthAction::*;
    let allowed = match context.action {
        Attach { .. } | Detach { .. } | Unknown { .. } => false,
        Pragma {
            pragma_name,
            pragma_value,
        } => {
            let name = pragma_name.to_ascii_lowercase();
            match name.as_str() {
                "table_info" | "table_xinfo" | "index_info" | "index_xinfo" | "index_list"
                | "foreign_key_list" => true,
                "data_version" | "schema_version" | "user_version" | "foreign_keys"
                | "journal_mode" | "page_size" | "integrity_check" | "quick_check" => {
                    pragma_value.is_none()
                }
                _ => false,
            }
        }
        CreateVtable { module_name, .. } | DropVtable { module_name, .. } => {
            matches!(module_name.to_ascii_lowercase().as_str(), "fts5" | "vec0")
        }
        // Explicit pure-function list: extensions may also register file-reading helpers
        // (e.g. vec_npy_file), so blocking only load_extension is insufficient.
        Function { function_name } => matches!(
            function_name.to_ascii_lowercase().as_str(),
            "abs"
                | "avg"
                | "count"
                | "sum"
                | "total"
                | "min"
                | "max"
                | "coalesce"
                | "ifnull"
                | "nullif"
                | "iif"
                | "length"
                | "lower"
                | "upper"
                | "trim"
                | "ltrim"
                | "rtrim"
                | "substr"
                | "substring"
                | "replace"
                | "instr"
                | "like"
                | "glob"
                | "round"
                | "typeof"
                | "cast"
                | "hex"
                | "quote"
                | "printf"
                | "format"
                | "date"
                | "time"
                | "datetime"
                | "strftime"
                | "julianday"
                | "unixepoch"
                | "group_concat"
                | "random"
                | "randomblob"
                | "zeroblob"
                | "changes"
                | "last_insert_rowid"
                | "json"
                | "json_extract"
                | "json_valid"
                | "json_array"
                | "json_object"
                | "match"
                | "bm25"
                | "highlight"
                | "snippet"
                | "fts5"
                | "sqlite_version"
                | "sqlite_rename_table"
                | "sqlite_rename_column"
                | "sqlite_rename_test"
                | "sqlite_drop_column"
                | "sqlite_rename_quotefix"
                | "vec_version"
                | "vec_f32"
                | "vec_length"
                | "vec_distance_cosine"
                | "vec_distance_l2"
        ),
        CreateIndex { .. }
        | CreateTable { .. }
        | CreateTempIndex { .. }
        | CreateTempTable { .. }
        | CreateTempTrigger { .. }
        | CreateTempView { .. }
        | CreateTrigger { .. }
        | CreateView { .. }
        | Delete { .. }
        | DropIndex { .. }
        | DropTable { .. }
        | DropTempIndex { .. }
        | DropTempTable { .. }
        | DropTempTrigger { .. }
        | DropTempView { .. }
        | DropTrigger { .. }
        | DropView { .. }
        | Insert { .. }
        | Read { .. }
        | Select
        | Transaction { .. }
        | Update { .. }
        | AlterTable { .. }
        | Reindex { .. }
        | Analyze { .. }
        | Savepoint { .. }
        | Recursive => true,
        _ => false,
    };
    if allowed {
        Authorization::Allow
    } else {
        Authorization::Deny
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_file_helpers_are_not_pure_functions() {
        for name in [
            "load_extension",
            "readfile",
            "writefile",
            "vec_npy_file",
            "VEC_NPY_FILE",
        ] {
            assert_eq!(
                authorize(AuthContext {
                    action: AuthAction::Function {
                        function_name: name
                    },
                    database_name: None,
                    accessor: None
                }),
                Authorization::Deny
            );
        }
    }
}

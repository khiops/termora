use serde::{Deserialize, Serialize};

/// All messages sent FROM the agent TO the hub.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentToHub {
    #[serde(rename = "HELLO")]
    Hello {
        version: u32,
        agent_version: String,
        capabilities: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        available_shells: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        default_shell: Option<String>,
    },
    #[serde(rename = "SPAWN_OK")]
    SpawnOk {
        request_id: String,
        channel_id: String,
    },
    #[serde(rename = "SPAWN_ERR")]
    SpawnErr {
        request_id: String,
        code: String,
        message: String,
    },
    #[serde(rename = "OUTPUT")]
    Output {
        channel_id: String,
        seq: u64,
        ts: String,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    #[serde(rename = "SNAPSHOT_RES")]
    SnapshotRes {
        channel_id: String,
        snapshot: SnapshotData,
        last_seq: u64,
    },
    #[serde(rename = "ATTACH_OK")]
    AttachOk {
        channel_id: String,
        snapshot: SnapshotData,
        last_seq: u64,
    },
    #[serde(rename = "CHANNEL_EXIT")]
    ChannelExit {
        channel_id: String,
        exit_code: i32,
        #[serde(skip_serializing_if = "Option::is_none")]
        signal: Option<String>,
    },
    #[serde(rename = "HEARTBEAT_ACK")]
    HeartbeatAck { ts: String },
    #[serde(rename = "TITLE_CHANGE")]
    TitleChange {
        channel_id: String,
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_title: Option<String>,
    },
    #[serde(rename = "PROCESS_TITLE")]
    ProcessTitle {
        channel_id: String,
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        display_title: Option<String>,
    },
    #[serde(rename = "BELL")]
    Bell { channel_id: String },
    #[serde(rename = "NOTIFICATION")]
    Notification { channel_id: String, message: String },
    #[serde(rename = "AGENT_CHANNEL_STATE")]
    AgentChannelState {
        channel_id: String,
        title: String,
        pid: u32,
        alive: bool,
    },
    #[serde(rename = "CHANNEL_STATE_END")]
    ChannelStateEnd {},
    #[serde(rename = "ERROR")]
    Error {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        channel_id: Option<String>,
    },
}

/// All messages sent FROM the hub TO the agent.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HubToAgent {
    #[serde(rename = "SPAWN")]
    Spawn {
        request_id: String,
        #[serde(default)]
        channel_id: Option<String>,
        #[serde(default)]
        shell: Option<String>,
        #[serde(default)]
        args: Option<Vec<String>>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        env: Option<std::collections::HashMap<String, String>>,
        cols: u16,
        rows: u16,
        #[serde(default)]
        direct_process: Option<bool>,
        #[serde(default)]
        elevated: Option<bool>,
        /// SECURITY NOTE: This arrives as plain String from serde deserialization.
        /// The handler MUST immediately wrap it in `Zeroizing<String>` and clear
        /// the original. A custom Deserialize impl for Zeroizing<String> would
        /// require a serde wrapper — deferred as non-critical since the window
        /// between deserialization and wrapping is a single function call.
        #[serde(default)]
        elevation_secret: Option<String>,
        #[serde(default)]
        elevation_method: Option<String>,
        #[serde(default)]
        custom_command: Option<String>,
    },
    #[serde(rename = "INPUT")]
    Input {
        channel_id: String,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    #[serde(rename = "RESIZE")]
    Resize {
        channel_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "SNAPSHOT_REQ")]
    SnapshotReq { channel_id: String },
    #[serde(rename = "ATTACH")]
    Attach { channel_id: String },
    #[serde(rename = "DESTROY")]
    Destroy { channel_id: String },
    #[serde(rename = "HEARTBEAT")]
    Heartbeat { ts: String },
    #[serde(rename = "ERROR")]
    Error {
        code: String,
        message: String,
        #[serde(default)]
        channel_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SnapshotData {
    pub serialized: String,
    pub cols: u16,
    pub rows: u16,
    pub cursor_x: u16,
    pub cursor_y: u16,
}

/// Standard error codes
pub mod error_codes {
    pub const SHELL_NOT_FOUND: &str = "SHELL_NOT_FOUND";
    pub const PERMISSION_DENIED: &str = "PERMISSION_DENIED";
    pub const PTY_SPAWN_FAILED: &str = "PTY_SPAWN_FAILED";
    pub const ELEVATION_PASSWORD_REQUIRED: &str = "ELEVATION_PASSWORD_REQUIRED";
    pub const INVALID_MESSAGE: &str = "INVALID_MESSAGE";
    pub const CHANNEL_NOT_FOUND: &str = "CHANNEL_NOT_FOUND";
    pub const CHANNEL_EXISTS: &str = "CHANNEL_EXISTS";
}

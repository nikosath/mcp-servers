# Filesystem MCP Server

Node.js server implementing Model Context Protocol (MCP) for filesystem operations.

## Features

- Read/write files
- Create/list/delete directories
- Move files/directories
- Search files
- Get file metadata
- Dynamic directory access control via [Roots](https://modelcontextprotocol.io/docs/learn/client-concepts#roots)

## Directory Access Control

The server uses a flexible directory access control system. Directories can be specified via command-line arguments or dynamically via [Roots](https://modelcontextprotocol.io/docs/learn/client-concepts#roots).

### Method 1: Command-line Arguments
Specify Allowed directories when starting the server:
```bash
mcp-server-filesystem /path/to/dir1 /path/to/dir2
```

### Method 2: MCP Roots (Recommended)
MCP clients that support [Roots](https://modelcontextprotocol.io/docs/learn/client-concepts#roots) can dynamically update the Allowed directories. 

Roots notified by Client to Server, completely replace any server-side Allowed directories when provided.

**Important**: If server starts without command-line arguments AND client doesn't support roots protocol (or provides empty roots), the server will throw an error during initialization.

This is the recommended method, as this enables runtime directory updates via `roots/list_changed` notifications without server restart, providing a more flexible and modern integration experience.

### How It Works

The server's directory access control follows this flow:

1. **Server Startup**
   - Server starts with directories from command-line arguments (if provided)
   - If no arguments provided, server starts with empty allowed directories

2. **Client Connection & Initialization**
   - Client connects and sends `initialize` request with capabilities
   - Server checks if client supports roots protocol (`capabilities.roots`)
   
3. **Roots Protocol Handling** (if client supports roots)
   - **On initialization**: Server requests roots from client via `roots/list`
   - Client responds with its configured roots
   - Server replaces ALL allowed directories with client's roots
   - **On runtime updates**: Client can send `notifications/roots/list_changed`
   - Server requests updated roots and replaces allowed directories again

4. **Fallback Behavior** (if client doesn't support roots)
   - Server continues using command-line directories only
   - No dynamic updates possible

5. **Access Control**
   - All filesystem operations are restricted to allowed directories
   - Use `list_allowed_directories` tool to see current directories
   - Server requires at least ONE allowed directory to operate

**Note**: The server will only allow operations within directories specified either via `args` or via Roots.

## Encoding Detection and Preservation

The server automatically detects and preserves file encodings when reading and writing text files. This prevents corruption of files encoded in non-UTF-8 character sets (such as Windows-1253 for Greek text).

### How It Works

1. **Reading Files**: When a file is read, the server:
   - Reads the file as a binary buffer
   - Tries each candidate encoding in order using round-trip verification
   - Decodes the buffer with a candidate encoding
   - Re-encodes the decoded string with the same encoding
   - If the re-encoded buffer matches the original buffer exactly, that encoding is selected
   - If no candidate succeeds, falls back to `chardet` for detection
   - Defaults to UTF-8 if detection fails

2. **Writing Files**: When a file is written:
   - Uses the detected encoding from the read operation
   - Encodes the content with the appropriate encoding before writing
   - Maintains byte-perfect compatibility with the original encoding

3. **Editing Files**: The `edit_file` tool:
   - Detects encoding when reading
   - Applies edits to the decoded text
   - Re-encodes with the detected encoding when writing
   - Preserves the original file's encoding

### Configuration Precedence

Candidate encodings can be configured through multiple methods, with the following precedence (highest to lowest):

1. **CLI flag** (highest priority)
   ```bash
   mcp-server-filesystem --candidate-encodings "utf-8,windows-1253,iso-8859-7" /path/to/dir
   ```

2. **Environment variable**
   ```bash
   export MCP_CANDIDATE_ENCODINGS="utf-8,windows-1253,iso-8859-7"
   mcp-server-filesystem /path/to/dir
   ```

3. **.vscode/settings.json** in repository root
   ```json
   {
     "files.candidateGuessEncodings": ["utf-8", "windows-1253", "iso-8859-7"]
   }
   ```
   Or as comma-separated string:
   ```json
   {
     "files.candidateGuessEncodings": "utf-8,windows-1253,iso-8859-7"
   }
   ```

4. **.mcp-server.json** at repository root (editable server config fallback)
   ```json
   {
     "files.candidateGuessEncodings": ["utf-8", "windows-1253", "iso-8859-7"]
   }
   ```

5. **Default fallback**: `["utf-8", "windows-1253"]`

### Supported Encodings

The server supports all encodings provided by `iconv-lite`, including:
- `utf-8` (UTF-8)
- `windows-1253` / `cp1253` (Greek)
- `iso-8859-7` (Greek)
- `iso-8859-1` / `latin1` (Western European)
- `ascii` (ASCII)
- And many more (see [iconv-lite documentation](https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings))

Encoding names are normalized and common aliases are supported (e.g., `cp1253` and `windows1253` both map to `windows-1253`).

### Usage Examples

#### Example 1: Working with Greek text files
```bash
# Start server with Greek encoding support
mcp-server-filesystem --candidate-encodings "utf-8,windows-1253,iso-8859-7" ~/documents

# The server will automatically detect and preserve Windows-1253 or ISO-8859-7 encoding
# when reading/writing Greek text files
```

#### Example 2: Using environment variable
```bash
# Set candidate encodings globally
export MCP_CANDIDATE_ENCODINGS="utf-8,windows-1252,iso-8859-1"

# Start server
mcp-server-filesystem ~/documents
```

#### Example 3: Project-specific configuration
Create `.mcp-server.json` in your project root:
```json
{
  "files.candidateGuessEncodings": ["utf-8", "windows-1253", "windows-1252", "iso-8859-1"]
}
```

Then start the server in that directory:
```bash
cd ~/my-project
mcp-server-filesystem .
```

### Migration Notes

**Breaking Changes**: None. The encoding detection is fully backward compatible.

**New Behavior**:
- Files are now read as buffers and encoding is auto-detected
- `readFileContent()` returns a string by default, preserving backward compatibility
- `writeFileContent()` now writes buffers encoded with the appropriate encoding
- `applyFileEdits()` preserves the original file's encoding

**Testing Your Configuration**:
1. Create a test file with non-UTF-8 content (e.g., Greek text in Windows-1253)
2. Read the file using `read_text_file` - text should display correctly
3. Edit the file using `edit_file` - encoding should be preserved
4. Verify the file's bytes remain unchanged for unmodified content

### Troubleshooting

**Issue**: Text displays as garbled characters
- **Solution**: Add the correct encoding to your candidate list. The encoding detection may be selecting the wrong encoding if the correct one isn't in the candidate list.

**Issue**: Encoding detection is slow
- **Solution**: Order your candidate encodings with the most common ones first. The server tries each encoding in order until one succeeds with round-trip verification.

**Issue**: Wrong encoding detected
- **Solution**: Be more specific with your candidate list. Remove unlikely encodings that might falsely match due to round-trip verification succeeding with incorrect encoding.



## API

### Tools

- **read_text_file**
  - Read complete contents of a file as text
  - Inputs:
    - `path` (string)
    - `head` (number, optional): First N lines
    - `tail` (number, optional): Last N lines
  - Automatically detects and decodes file encoding (see Encoding Detection section)
  - Returns properly decoded text regardless of original encoding
  - Cannot specify both `head` and `tail` simultaneously

- **read_media_file**
  - Read an image or audio file
  - Inputs:
    - `path` (string)
  - Streams the file and returns base64 data with the corresponding MIME type

- **read_multiple_files**
  - Read multiple files simultaneously
  - Input: `paths` (string[])
  - Failed reads won't stop the entire operation

- **write_file**
  - Create new file or overwrite existing (exercise caution with this)
  - Inputs:
    - `path` (string): File location
    - `content` (string): File content
  - Automatically preserves file encoding when overwriting existing files

- **edit_file**
  - Make selective edits using advanced pattern matching and formatting
  - Features:
    - Line-based and multi-line content matching
    - Whitespace normalization with indentation preservation
    - Multiple simultaneous edits with correct positioning
    - Indentation style detection and preservation
    - Git-style diff output with context
    - Preview changes with dry run mode
    - Automatic encoding detection and preservation
  - Inputs:
    - `path` (string): File to edit
    - `edits` (array): List of edit operations
      - `oldText` (string): Text to search for (can be substring)
      - `newText` (string): Text to replace with
    - `dryRun` (boolean): Preview changes without applying (default: false)
  - Returns detailed diff and match information for dry runs, otherwise applies changes
  - Preserves the original file's encoding (e.g., Windows-1253, ISO-8859-7)
  - Best Practice: Always use dryRun first to preview changes before applying them

- **create_directory**
  - Create new directory or ensure it exists
  - Input: `path` (string)
  - Creates parent directories if needed
  - Succeeds silently if directory exists

- **list_directory**
  - List directory contents with [FILE] or [DIR] prefixes
  - Input: `path` (string)

- **list_directory_with_sizes**
  - List directory contents with [FILE] or [DIR] prefixes, including file sizes
  - Inputs:
    - `path` (string): Directory path to list
    - `sortBy` (string, optional): Sort entries by "name" or "size" (default: "name")
  - Returns detailed listing with file sizes and summary statistics
  - Shows total files, directories, and combined size

- **move_file**
  - Move or rename files and directories
  - Inputs:
    - `source` (string)
    - `destination` (string)
  - Fails if destination exists

- **search_files**
  - Recursively search for files/directories that match or do not match patterns
  - Inputs:
    - `path` (string): Starting directory
    - `pattern` (string): Search pattern
    - `excludePatterns` (string[]): Exclude any patterns.
  - Glob-style pattern matching
  - Returns full paths to matches

- **directory_tree**
  - Get recursive JSON tree structure of directory contents
  - Inputs:
    - `path` (string): Starting directory
    - `excludePatterns` (string[]): Exclude any patterns. Glob formats are supported.
  - Returns:
    - JSON array where each entry contains:
      - `name` (string): File/directory name
      - `type` ('file'|'directory'): Entry type
      - `children` (array): Present only for directories
        - Empty array for empty directories
        - Omitted for files
  - Output is formatted with 2-space indentation for readability
    
- **get_file_info**
  - Get detailed file/directory metadata
  - Input: `path` (string)
  - Returns:
    - Size
    - Creation time
    - Modified time
    - Access time
    - Type (file/directory)
    - Permissions

- **list_allowed_directories**
  - List all directories the server is allowed to access
  - No input required
  - Returns:
    - Directories that this server can read/write from

### Tool annotations (MCP hints)

This server sets [MCP ToolAnnotations](https://modelcontextprotocol.io/specification/2025-03-26/server/tools#toolannotations)
on each tool so clients can:

- Distinguish **read‑only** tools from write‑capable tools.
- Understand which write operations are **idempotent** (safe to retry with the same arguments).
- Highlight operations that may be **destructive** (overwriting or heavily mutating data).

The mapping for filesystem tools is:

| Tool                        | readOnlyHint | idempotentHint | destructiveHint | Notes                                            |
|-----------------------------|--------------|----------------|-----------------|--------------------------------------------------|
| `read_text_file`            | `true`       | –              | –               | Pure read                                       |
| `read_media_file`           | `true`       | –              | –               | Pure read                                       |
| `read_multiple_files`       | `true`       | –              | –               | Pure read                                       |
| `list_directory`            | `true`       | –              | –               | Pure read                                       |
| `list_directory_with_sizes` | `true`       | –              | –               | Pure read                                       |
| `directory_tree`            | `true`       | –              | –               | Pure read                                       |
| `search_files`              | `true`       | –              | –               | Pure read                                       |
| `get_file_info`             | `true`       | –              | –               | Pure read                                       |
| `list_allowed_directories`  | `true`       | –              | –               | Pure read                                       |
| `create_directory`          | `false`      | `true`         | `false`         | Re‑creating the same dir is a no‑op             |
| `write_file`                | `false`      | `true`         | `true`          | Overwrites existing files                       |
| `edit_file`                 | `false`      | `false`        | `true`          | Re‑applying edits can fail or double‑apply      |
| `move_file`                 | `false`      | `false`        | `false`         | Move/rename only; repeat usually errors         |

> Note: `idempotentHint` and `destructiveHint` are meaningful only when `readOnlyHint` is `false`, as defined by the MCP spec.

## Usage with Claude Desktop
Add this to your `claude_desktop_config.json`:

Note: you can provide sandboxed directories to the server by mounting them to `/projects`. Adding the `ro` flag will make the directory readonly by the server.

### Docker
Note: all directories must be mounted to `/projects` by default.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--mount", "type=bind,src=/Users/username/Desktop,dst=/projects/Desktop",
        "--mount", "type=bind,src=/path/to/other/allowed/dir,dst=/projects/other/allowed/dir,ro",
        "--mount", "type=bind,src=/path/to/file.txt,dst=/projects/path/to/file.txt",
        "mcp/filesystem",
        "/projects"
      ]
    }
  }
}
```

### NPX

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/Desktop",
        "/path/to/other/allowed/dir"
      ]
    }
  }
}
```

## Usage with VS Code

For quick installation, click the installation buttons below...

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-NPM-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=filesystem&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40modelcontextprotocol%2Fserver-filesystem%22%2C%22%24%7BworkspaceFolder%7D%22%5D%7D) [![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-NPM-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=filesystem&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40modelcontextprotocol%2Fserver-filesystem%22%2C%22%24%7BworkspaceFolder%7D%22%5D%7D&quality=insiders)

[![Install with Docker in VS Code](https://img.shields.io/badge/VS_Code-Docker-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=filesystem&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-i%22%2C%22--rm%22%2C%22--mount%22%2C%22type%3Dbind%2Csrc%3D%24%7BworkspaceFolder%7D%2Cdst%3D%2Fprojects%2Fworkspace%22%2C%22mcp%2Ffilesystem%22%2C%22%2Fprojects%22%5D%7D) [![Install with Docker in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Docker-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=filesystem&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-i%22%2C%22--rm%22%2C%22--mount%22%2C%22type%3Dbind%2Csrc%3D%24%7BworkspaceFolder%7D%2Cdst%3D%2Fprojects%2Fworkspace%22%2C%22mcp%2Ffilesystem%22%2C%22%2Fprojects%22%5D%7D&quality=insiders)

For manual installation, you can configure the MCP server using one of these methods:

**Method 1: User Configuration (Recommended)**
Add the configuration to your user-level MCP configuration file. Open the Command Palette (`Ctrl + Shift + P`) and run `MCP: Open User Configuration`. This will open your user `mcp.json` file where you can add the server configuration.

**Method 2: Workspace Configuration**
Alternatively, you can add the configuration to a file called `.vscode/mcp.json` in your workspace. This will allow you to share the configuration with others.

> For more details about MCP configuration in VS Code, see the [official VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

You can provide sandboxed directories to the server by mounting them to `/projects`. Adding the `ro` flag will make the directory readonly by the server.

### Docker
Note: all directories must be mounted to `/projects` by default. 

```json
{
  "servers": {
    "filesystem": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--mount", "type=bind,src=${workspaceFolder},dst=/projects/workspace",
        "mcp/filesystem",
        "/projects"
      ]
    }
  }
}
```

### NPX

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${workspaceFolder}"
      ]
    }
  }
}
```

## Build

Docker build:

```bash
docker build -t mcp/filesystem -f src/filesystem/Dockerfile .
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.

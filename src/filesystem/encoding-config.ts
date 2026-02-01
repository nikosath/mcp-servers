import fs from "fs/promises";
import path from "path";

/**
 * Default candidate encodings to try in order
 */
const DEFAULT_CANDIDATES = ["utf-8", "windows-1253"];

/**
 * Normalize encoding names to common forms accepted by iconv-lite
 * Maps common aliases to standardized names
 */
function normalizeEncoding(encoding: string): string {
  const normalized = encoding.toLowerCase().trim();
  
  // Map common aliases
  const aliases: Record<string, string> = {
    'utf8': 'utf-8',
    'windows1253': 'windows-1253',
    'cp1253': 'windows-1253',
    'iso88597': 'iso-8859-7',
    'iso-88597': 'iso-8859-7',
  };
  
  return aliases[normalized] || normalized;
}

/**
 * Parse candidate encodings from a value that can be either:
 * - An array of strings
 * - A comma-separated string
 */
function parseCandidates(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value
      .filter(item => typeof item === 'string')
      .map(normalizeEncoding);
  }
  
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(normalizeEncoding);
  }
  
  return null;
}

/**
 * Try to read and parse candidate encodings from .vscode/settings.json
 * 
 * Security Note: This reads from process.cwd() which is controlled by the server operator
 * who launches the MCP server. This is not a security risk as the operator already has
 * full control over the server's working directory and file access permissions.
 */
async function readVSCodeSettings(): Promise<string[] | null> {
  try {
    const settingsPath = path.join(process.cwd(), '.vscode', 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    
    if ('files.candidateGuessEncodings' in settings) {
      return parseCandidates(settings['files.candidateGuessEncodings']);
    }
  } catch (error) {
    // File doesn't exist or is malformed - gracefully ignore
  }
  
  return null;
}

/**
 * Try to read and parse candidate encodings from .mcp-server.json
 * 
 * Security Note: This reads from process.cwd() which is controlled by the server operator
 * who launches the MCP server. This is not a security risk as the operator already has
 * full control over the server's working directory and file access permissions.
 */
async function readMCPServerConfig(): Promise<string[] | null> {
  try {
    const configPath = path.join(process.cwd(), '.mcp-server.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    if ('files.candidateGuessEncodings' in config) {
      return parseCandidates(config['files.candidateGuessEncodings']);
    }
  } catch (error) {
    // File doesn't exist or is malformed - gracefully ignore
  }
  
  return null;
}

/**
 * Get the ordered list of candidate encodings to try for file detection.
 * 
 * Precedence order:
 * 1. MCP_CANDIDATE_ENCODINGS environment variable
 * 2. .vscode/settings.json with key "files.candidateGuessEncodings"
 * 3. .mcp-server.json with key "files.candidateGuessEncodings"
 * 4. Default: ["utf-8", "windows-1253"]
 * 
 * @returns Array of normalized encoding names in order of preference
 */
export async function getCandidateEncodings(): Promise<string[]> {
  // 1. Check environment variable
  const envVar = process.env.MCP_CANDIDATE_ENCODINGS;
  if (envVar) {
    const candidates = parseCandidates(envVar);
    if (candidates && candidates.length > 0) {
      return candidates;
    }
  }
  
  // 2. Check .vscode/settings.json
  const vscodeSettings = await readVSCodeSettings();
  if (vscodeSettings && vscodeSettings.length > 0) {
    return vscodeSettings;
  }
  
  // 3. Check .mcp-server.json
  const mcpConfig = await readMCPServerConfig();
  if (mcpConfig && mcpConfig.length > 0) {
    return mcpConfig;
  }
  
  // 4. Use defaults
  return DEFAULT_CANDIDATES;
}

import fs from 'fs/promises';
import path from 'path';

/**
 * Normalized encoding names mapping common aliases to standard names
 */
const ENCODING_ALIASES: Record<string, string> = {
  'utf8': 'utf-8',
  'utf-8': 'utf-8',
  'cp1253': 'windows-1253',
  'windows1253': 'windows-1253',
  'windows-1253': 'windows-1253',
  'iso88597': 'iso-8859-7',
  'iso-8859-7': 'iso-8859-7',
  'latin1': 'iso-8859-1',
  'iso88591': 'iso-8859-1',
  'iso-8859-1': 'iso-8859-1',
  'ascii': 'ascii',
};

/**
 * Default candidate encodings fallback
 */
const DEFAULT_CANDIDATE_ENCODINGS = ['utf-8', 'windows-1253'];

/**
 * Normalize encoding name using aliases
 */
export function normalizeEncodingName(encoding: string): string {
  const normalized = encoding.toLowerCase().trim();
  return ENCODING_ALIASES[normalized] || normalized;
}

/**
 * Parse comma-separated encoding list
 */
function parseEncodingList(input: string | string[] | undefined): string[] | null {
  if (!input) return null;
  
  try {
    if (Array.isArray(input)) {
      return input.map(e => normalizeEncodingName(e)).filter(e => e.length > 0);
    }
    
    if (typeof input === 'string') {
      return input
        .split(',')
        .map(e => normalizeEncodingName(e))
        .filter(e => e.length > 0);
    }
  } catch (error) {
    console.error('Error parsing encoding list:', error);
  }
  
  return null;
}

/**
 * Read and parse .vscode/settings.json
 */
async function getVSCodeCandidates(): Promise<string[] | null> {
  try {
    const settingsPath = path.join(process.cwd(), '.vscode', 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const candidates = settings['files.candidateGuessEncodings'];
    return parseEncodingList(candidates);
  } catch (error) {
    // File doesn't exist or is malformed, return null
    return null;
  }
}

/**
 * Read and parse .mcp-server.json
 */
async function getMcpServerCandidates(): Promise<string[] | null> {
  try {
    const configPath = path.join(process.cwd(), '.mcp-server.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    const candidates = config['files.candidateGuessEncodings'];
    return parseEncodingList(candidates);
  } catch (error) {
    // File doesn't exist or is malformed, return null
    return null;
  }
}

/**
 * Get candidate encodings with precedence order:
 * 1. CLI flag
 * 2. Environment variable
 * 3. .vscode/settings.json
 * 4. .mcp-server.json
 * 5. Default fallback
 */
export async function getCandidateEncodings(cliFlag?: string): Promise<string[]> {
  // 1. CLI flag (highest priority)
  if (cliFlag) {
    const parsed = parseEncodingList(cliFlag);
    if (parsed && parsed.length > 0) {
      return parsed;
    }
  }
  
  // 2. Environment variable
  const envVar = process.env.MCP_CANDIDATE_ENCODINGS;
  if (envVar) {
    const parsed = parseEncodingList(envVar);
    if (parsed && parsed.length > 0) {
      return parsed;
    }
  }
  
  // 3. .vscode/settings.json
  const vscodeCandidates = await getVSCodeCandidates();
  if (vscodeCandidates && vscodeCandidates.length > 0) {
    return vscodeCandidates;
  }
  
  // 4. .mcp-server.json
  const mcpCandidates = await getMcpServerCandidates();
  if (mcpCandidates && mcpCandidates.length > 0) {
    return mcpCandidates;
  }
  
  // 5. Default fallback
  return DEFAULT_CANDIDATE_ENCODINGS;
}

import fs from "fs/promises";
import path from "path";
import os from 'os';
import { randomBytes } from 'crypto';
import { diffLines, createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';
import iconv from 'iconv-lite';
import chardet from 'chardet';
import { normalizePath, expandHome } from './path-utils.js';
import { isPathWithinAllowedDirectories } from './path-validation.js';
import { getCandidateEncodings } from './encoding-config.js';

// Global allowed directories - set by the main module
let allowedDirectories: string[] = [];

// Function to set allowed directories from the main module
export function setAllowedDirectories(directories: string[]): void {
  allowedDirectories = [...directories];
}

// Function to get current allowed directories
export function getAllowedDirectories(): string[] {
  return [...allowedDirectories];
}

// Type definitions
interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

export interface SearchOptions {
  excludePatterns?: string[];
}

export interface SearchResult {
  path: string;
  isDirectory: boolean;
}

// Encoding detection result
export interface EncodingDetectionResult {
  content: string;
  encoding: string;
}

// Encoding helper functions
/**
 * Normalize encoding name to a canonical form
 * Examples: windows1253 -> windows-1253, cp1253 -> windows-1253, utf8 -> utf-8
 */
export function normalizeEncodingName(encoding: string): string {
  const normalized = encoding.toLowerCase().trim();
  
  // Common aliases
  const aliases: Record<string, string> = {
    'utf8': 'utf-8',
    'utf-8': 'utf-8',
    'windows1253': 'windows-1253',
    'cp1253': 'windows-1253',
    'windows-1253': 'windows-1253',
    'iso88597': 'iso-8859-7',
    'iso-8859-7': 'iso-8859-7',
    'latin7': 'iso-8859-7',
  };
  
  return aliases[normalized] || normalized;
}

/**
 * Detect file encoding using ordered candidate list with round-trip validation
 * @param buffer - Raw file buffer
 * @param candidateEncodings - Ordered list of candidate encodings to try
 * @returns Detected encoding name
 */
export function detectEncoding(buffer: Buffer, candidateEncodings: string[]): string {
  // Try each candidate encoding with round-trip validation
  for (const candidate of candidateEncodings) {
    const normalizedEncoding = normalizeEncodingName(candidate);
    
    // Check if encoding is supported by iconv-lite
    if (!iconv.encodingExists(normalizedEncoding)) {
      continue;
    }
    
    try {
      // Decode with candidate encoding
      const decoded = iconv.decode(buffer, normalizedEncoding);
      
      // Re-encode back to buffer
      const reencoded = iconv.encode(decoded, normalizedEncoding);
      
      // Compare buffers - if they match, this encoding is valid
      if (buffer.equals(reencoded)) {
        return normalizedEncoding;
      }
    } catch (error) {
      // Encoding failed, try next candidate
      continue;
    }
  }
  
  // No candidate passed round-trip test, use chardet as fallback
  const detected = chardet.detect(buffer);
  if (detected) {
    const normalizedDetected = normalizeEncodingName(detected);
    if (iconv.encodingExists(normalizedDetected)) {
      return normalizedDetected;
    }
  }
  
  // Final fallback to UTF-8
  return 'utf-8';
}

// Pure Utility Functions
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  if (i < 0 || i === 0) return `${bytes} ${units[0]}`;
  
  const unitIndex = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`;
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function createUnifiedDiff(originalContent: string, newContent: string, filepath: string = 'file'): string {
  // Ensure consistent line endings for diff
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    'original',
    'modified'
  );
}

// Security & Validation Functions
export async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Security: Check if path is within allowed directories before any file operations
  const isAllowed = isPathWithinAllowedDirectories(normalizedRequested, allowedDirectories);
  if (!isAllowed) {
    throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
  }

  // Security: Handle symlinks by checking their real path to prevent symlink attacks
  // This prevents attackers from creating symlinks that point outside allowed directories
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    if (!isPathWithinAllowedDirectories(normalizedReal, allowedDirectories)) {
      throw new Error(`Access denied - symlink target outside allowed directories: ${realPath} not in ${allowedDirectories.join(', ')}`);
    }
    return realPath;
  } catch (error) {
    // Security: For new files that don't exist yet, verify parent directory
    // This ensures we can't create files in unauthorized locations
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const parentDir = path.dirname(absolute);
      try {
        const realParentPath = await fs.realpath(parentDir);
        const normalizedParent = normalizePath(realParentPath);
        if (!isPathWithinAllowedDirectories(normalizedParent, allowedDirectories)) {
          throw new Error(`Access denied - parent directory outside allowed directories: ${realParentPath} not in ${allowedDirectories.join(', ')}`);
        }
        return absolute;
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`);
      }
    }
    throw error;
  }
}


// File Operations
export async function getFileStats(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

/**
 * Read file content with encoding detection
 * @param filePath - Path to the file
 * @param encoding - Optional explicit encoding. If not provided, will auto-detect.
 * @returns File content as string
 */
export async function readFileContent(filePath: string, encoding?: string): Promise<string> {
  if (encoding) {
    // Explicit encoding provided - use it directly
    return await fs.readFile(filePath, encoding as BufferEncoding);
  }
  
  // Auto-detect encoding
  const buffer = await fs.readFile(filePath);
  const candidates = await getCandidateEncodings(path.dirname(filePath));
  const detectedEncoding = detectEncoding(buffer, candidates);
  
  return iconv.decode(buffer, detectedEncoding);
}

/**
 * Read file content and return both content and detected encoding
 * @param filePath - Path to the file
 * @returns Object with content and encoding
 */
export async function readFileContentWithEncoding(filePath: string): Promise<EncodingDetectionResult> {
  const buffer = await fs.readFile(filePath);
  const candidates = await getCandidateEncodings(path.dirname(filePath));
  const encoding = detectEncoding(buffer, candidates);
  const content = iconv.decode(buffer, encoding);
  
  return { content, encoding };
}


/**
 * Write file content with optional encoding
 * @param filePath - Path to the file
 * @param content - Content to write
 * @param encoding - Optional encoding (defaults to utf-8)
 */
export async function writeFileContent(filePath: string, content: string, encoding: string = 'utf-8'): Promise<void> {
  const normalizedEncoding = normalizeEncodingName(encoding);
  
  // Encode content to buffer using the specified encoding
  const buffer = iconv.encode(content, normalizedEncoding);
  
  try {
    // Security: 'wx' flag ensures exclusive creation - fails if file/symlink exists,
    // preventing writes through pre-existing symlinks
    await fs.writeFile(filePath, buffer, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // Security: Use atomic rename to prevent race conditions where symlinks
      // could be created between validation and write. Rename operations
      // replace the target file atomically and don't follow symlinks.
      const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
      try {
        await fs.writeFile(tempPath, buffer);
        await fs.rename(tempPath, filePath);
      } catch (renameError) {
        try {
          await fs.unlink(tempPath);
        } catch {}
        throw renameError;
      }
    } else {
      throw error;
    }
  }
}


// File Editing Functions
interface FileEdit {
  oldText: string;
  newText: string;
}

export async function applyFileEdits(
  filePath: string,
  edits: FileEdit[],
  dryRun: boolean = false
): Promise<string> {
  // Read file content with encoding detection and normalize line endings
  const { content: rawContent, encoding } = await readFileContentWithEncoding(filePath);
  const content = normalizeLineEndings(rawContent);

  // Apply edits sequentially
  let modifiedContent = content;
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    // If exact match exists, use it
    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }

    // Otherwise, try line-by-line matching with flexibility for whitespace
    const oldLines = normalizedOld.split('\n');
    const contentLines = modifiedContent.split('\n');
    let matchFound = false;

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);

      // Compare lines with normalized whitespace
      const isMatch = oldLines.every((oldLine, j) => {
        const contentLine = potentialMatch[j];
        return oldLine.trim() === contentLine.trim();
      });

      if (isMatch) {
        // Preserve original indentation of first line
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
        const newLines = normalizedNew.split('\n').map((line, j) => {
          if (j === 0) return originalIndent + line.trimStart();
          // For subsequent lines, try to preserve relative indentation
          const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
          const newIndent = line.match(/^\s*/)?.[0] || '';
          if (oldIndent && newIndent) {
            const relativeIndent = newIndent.length - oldIndent.length;
            return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
          }
          return line;
        });

        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join('\n');
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }

  // Create unified diff
  const diff = createUnifiedDiff(content, modifiedContent, filePath);

  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (diff.includes('`'.repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;

  if (!dryRun) {
    // Security: Use atomic rename to prevent race conditions where symlinks
    // could be created between validation and write. Rename operations
    // replace the target file atomically and don't follow symlinks.
    // Preserve the detected encoding when writing back
    const normalizedEncoding = normalizeEncodingName(encoding);
    const buffer = iconv.encode(modifiedContent, normalizedEncoding);
    
    const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tempPath, buffer);
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  return formattedDiff;
}

// Memory-efficient implementation to get the last N lines of a file
export async function tailFile(filePath: string, numLines: number): Promise<string> {
  const CHUNK_SIZE = 1024; // Read 1KB at a time
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;
  
  if (fileSize === 0) return '';
  
  // Open file for reading
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const lines: string[] = [];
    let position = fileSize;
    let chunk = Buffer.alloc(CHUNK_SIZE);
    let linesFound = 0;
    let remainingText = '';
    
    // Read chunks from the end of the file until we have enough lines
    while (position > 0 && linesFound < numLines) {
      const size = Math.min(CHUNK_SIZE, position);
      position -= size;
      
      const { bytesRead } = await fileHandle.read(chunk, 0, size, position);
      if (!bytesRead) break;
      
      // Get the chunk as a string and prepend any remaining text from previous iteration
      const readData = chunk.slice(0, bytesRead).toString('utf-8');
      const chunkText = readData + remainingText;
      
      // Split by newlines and count
      const chunkLines = normalizeLineEndings(chunkText).split('\n');
      
      // If this isn't the end of the file, the first line is likely incomplete
      // Save it to prepend to the next chunk
      if (position > 0) {
        remainingText = chunkLines[0];
        chunkLines.shift(); // Remove the first (incomplete) line
      }
      
      // Add lines to our result (up to the number we need)
      for (let i = chunkLines.length - 1; i >= 0 && linesFound < numLines; i--) {
        lines.unshift(chunkLines[i]);
        linesFound++;
      }
    }
    
    return lines.join('\n');
  } finally {
    await fileHandle.close();
  }
}

// New function to get the first N lines of a file
export async function headFile(filePath: string, numLines: number): Promise<string> {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const lines: string[] = [];
    let buffer = '';
    let bytesRead = 0;
    const chunk = Buffer.alloc(1024); // 1KB buffer
    
    // Read chunks and count lines until we have enough or reach EOF
    while (lines.length < numLines) {
      const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break; // End of file
      bytesRead += result.bytesRead;
      buffer += chunk.slice(0, result.bytesRead).toString('utf-8');
      
      const newLineIndex = buffer.lastIndexOf('\n');
      if (newLineIndex !== -1) {
        const completeLines = buffer.slice(0, newLineIndex).split('\n');
        buffer = buffer.slice(newLineIndex + 1);
        for (const line of completeLines) {
          lines.push(line);
          if (lines.length >= numLines) break;
        }
      }
    }
    
    // If there is leftover content and we still need lines, add it
    if (buffer.length > 0 && lines.length < numLines) {
      lines.push(buffer);
    }
    
    return lines.join('\n');
  } finally {
    await fileHandle.close();
  }
}

export async function searchFilesWithValidation(
  rootPath: string,
  pattern: string,
  allowedDirectories: string[],
  options: SearchOptions = {}
): Promise<string[]> {
  const { excludePatterns = [] } = options;
  const results: string[] = [];

  async function search(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      try {
        await validatePath(fullPath);

        const relativePath = path.relative(rootPath, fullPath);
        const shouldExclude = excludePatterns.some(excludePattern =>
          minimatch(relativePath, excludePattern, { dot: true })
        );

        if (shouldExclude) continue;

        // Use glob matching for the search pattern
        if (minimatch(relativePath, pattern, { dot: true })) {
          results.push(fullPath);
        }

        if (entry.isDirectory()) {
          await search(fullPath);
        }
      } catch {
        continue;
      }
    }
  }

  await search(rootPath);
  return results;
}

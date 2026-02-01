import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import iconv from 'iconv-lite';
import {
  // Pure utility functions
  formatSize,
  normalizeLineEndings,
  createUnifiedDiff,
  // Encoding functions
  normalizeEncodingName,
  detectEncoding,
  // Security & validation functions
  validatePath,
  setAllowedDirectories,
  // File operations
  getFileStats,
  readFileContent,
  readFileContentWithEncoding,
  writeFileContent,
  // Search & filtering functions
  searchFilesWithValidation,
  // File editing functions
  applyFileEdits,
  tailFile,
  headFile
} from '../lib.js';

// Mock fs module
vi.mock('fs/promises');
const mockFs = fs as any;

// Mock encoding-config module
vi.mock('../encoding-config.js', () => ({
  getCandidateEncodings: vi.fn(async () => ['utf-8', 'windows1253'])
}));

describe('Lib Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up allowed directories for tests
    const allowedDirs = process.platform === 'win32' ? ['C:\\Users\\test', 'C:\\temp', 'C:\\allowed'] : ['/home/user', '/tmp', '/allowed'];
    setAllowedDirectories(allowedDirs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear allowed directories after tests
    setAllowedDirectories([]);
  });

  describe('Pure Utility Functions', () => {
    describe('formatSize', () => {
      it('formats bytes correctly', () => {
        expect(formatSize(0)).toBe('0 B');
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(1024)).toBe('1.00 KB');
        expect(formatSize(1536)).toBe('1.50 KB');
        expect(formatSize(1048576)).toBe('1.00 MB');
        expect(formatSize(1073741824)).toBe('1.00 GB');
        expect(formatSize(1099511627776)).toBe('1.00 TB');
      });

      it('handles edge cases', () => {
        expect(formatSize(1023)).toBe('1023 B');
        expect(formatSize(1025)).toBe('1.00 KB');
        expect(formatSize(1048575)).toBe('1024.00 KB');
      });

      it('handles very large numbers beyond TB', () => {
        // The function only supports up to TB, so very large numbers will show as TB
        expect(formatSize(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1024.00 TB');
        expect(formatSize(Number.MAX_SAFE_INTEGER)).toContain('TB');
      });

      it('handles negative numbers', () => {
        // Negative numbers will result in NaN for the log calculation
        expect(formatSize(-1024)).toContain('NaN');
        expect(formatSize(-0)).toBe('0 B');
      });

      it('handles decimal numbers', () => {
        expect(formatSize(1536.5)).toBe('1.50 KB');
        expect(formatSize(1023.9)).toBe('1023.9 B');
      });

      it('handles very small positive numbers', () => {
        expect(formatSize(1)).toBe('1 B');
        expect(formatSize(0.5)).toBe('0.5 B');
        expect(formatSize(0.1)).toBe('0.1 B');
      });
    });

    describe('normalizeLineEndings', () => {
      it('converts CRLF to LF', () => {
        expect(normalizeLineEndings('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3');
      });

      it('leaves LF unchanged', () => {
        expect(normalizeLineEndings('line1\nline2\nline3')).toBe('line1\nline2\nline3');
      });

      it('handles mixed line endings', () => {
        expect(normalizeLineEndings('line1\r\nline2\nline3\r\n')).toBe('line1\nline2\nline3\n');
      });

      it('handles empty string', () => {
        expect(normalizeLineEndings('')).toBe('');
      });
    });

    describe('createUnifiedDiff', () => {
      it('creates diff for simple changes', () => {
        const original = 'line1\nline2\nline3';
        const modified = 'line1\nmodified line2\nline3';
        const diff = createUnifiedDiff(original, modified, 'test.txt');
        
        expect(diff).toContain('--- test.txt');
        expect(diff).toContain('+++ test.txt');
        expect(diff).toContain('-line2');
        expect(diff).toContain('+modified line2');
      });

      it('handles CRLF normalization', () => {
        const original = 'line1\r\nline2\r\n';
        const modified = 'line1\nmodified line2\n';
        const diff = createUnifiedDiff(original, modified);
        
        expect(diff).toContain('-line2');
        expect(diff).toContain('+modified line2');
      });

      it('handles identical content', () => {
        const content = 'line1\nline2\nline3';
        const diff = createUnifiedDiff(content, content);
        
        // Should not contain any +/- lines for identical content (excluding header lines)
        expect(diff.split('\n').filter((line: string) => line.startsWith('+++') || line.startsWith('---'))).toHaveLength(2);
        expect(diff.split('\n').filter((line: string) => line.startsWith('+') && !line.startsWith('+++'))).toHaveLength(0);
        expect(diff.split('\n').filter((line: string) => line.startsWith('-') && !line.startsWith('---'))).toHaveLength(0);
      });

      it('handles empty content', () => {
        const diff = createUnifiedDiff('', '');
        expect(diff).toContain('--- file');
        expect(diff).toContain('+++ file');
      });

      it('handles default filename parameter', () => {
        const diff = createUnifiedDiff('old', 'new');
        expect(diff).toContain('--- file');
        expect(diff).toContain('+++ file');
      });

      it('handles custom filename', () => {
        const diff = createUnifiedDiff('old', 'new', 'custom.txt');
        expect(diff).toContain('--- custom.txt');
        expect(diff).toContain('+++ custom.txt');
      });
    });

    describe('normalizeEncodingName', () => {
      it('normalizes common encoding aliases', () => {
        expect(normalizeEncodingName('utf8')).toBe('utf-8');
        expect(normalizeEncodingName('UTF-8')).toBe('utf-8');
        expect(normalizeEncodingName('windows1253')).toBe('windows-1253');
        expect(normalizeEncodingName('cp1253')).toBe('windows-1253');
        expect(normalizeEncodingName('iso88597')).toBe('iso-8859-7');
      });

      it('preserves normalized encoding names', () => {
        expect(normalizeEncodingName('utf-8')).toBe('utf-8');
        expect(normalizeEncodingName('windows-1253')).toBe('windows-1253');
      });

      it('handles case insensitivity', () => {
        expect(normalizeEncodingName('UTF8')).toBe('utf-8');
        expect(normalizeEncodingName('WINDOWS1253')).toBe('windows-1253');
      });
    });

    describe('detectEncoding', () => {
      it('detects UTF-8 encoding via round-trip', () => {
        const text = 'Hello, world! 你好世界';
        const buffer = Buffer.from(text, 'utf-8');
        
        const detected = detectEncoding(buffer, ['utf-8', 'windows-1253']);
        expect(detected).toBe('utf-8');
      });

      it('detects Windows-1253 encoding via round-trip', () => {
        // Greek text in Windows-1253
        const greekText = 'Γεια σου κόσμε';
        const buffer = iconv.encode(greekText, 'windows-1253');
        
        const detected = detectEncoding(buffer, ['windows-1253', 'utf-8']);
        expect(detected).toBe('windows-1253');
      });

      it('tries candidates in order', () => {
        const text = 'Simple ASCII text';
        const buffer = Buffer.from(text, 'utf-8');
        
        // ASCII text will round-trip successfully with the first candidate
        const detected = detectEncoding(buffer, ['windows-1253', 'utf-8']);
        expect(detected).toBe('windows-1253');
      });

      it('falls back to utf-8 if no candidate succeeds', () => {
        const buffer = Buffer.from('test', 'utf-8');
        
        // Test with unsupported encoding - since chardet may detect simple ASCII,
        // we verify it returns a valid encoding
        const detected = detectEncoding(buffer, ['unsupported-encoding']);
        // chardet might detect 'ascii' for simple text, which is valid
        expect(['utf-8', 'ascii', 'us-ascii']).toContain(detected);
      });
    });
  });

  describe('Security & Validation Functions', () => {
    describe('validatePath', () => {
      // Use Windows-compatible paths for testing
      const allowedDirs = process.platform === 'win32' ? ['C:\\Users\\test', 'C:\\temp'] : ['/home/user', '/tmp'];

      beforeEach(() => {
        mockFs.realpath.mockImplementation(async (path: any) => path.toString());
      });

      it('validates allowed paths', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\Users\\test\\file.txt' : '/home/user/file.txt';
        const result = await validatePath(testPath);
        expect(result).toBe(testPath);
      });

      it('rejects disallowed paths', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\Windows\\System32\\file.txt' : '/etc/passwd';
        await expect(validatePath(testPath))
          .rejects.toThrow('Access denied - path outside allowed directories');
      });

      it('handles non-existent files by checking parent directory', async () => {
        const newFilePath = process.platform === 'win32' ? 'C:\\Users\\test\\newfile.txt' : '/home/user/newfile.txt';
        const parentPath = process.platform === 'win32' ? 'C:\\Users\\test' : '/home/user';
        
        // Create an error with the ENOENT code that the implementation checks for
        const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        
        mockFs.realpath
          .mockRejectedValueOnce(enoentError)
          .mockResolvedValueOnce(parentPath);
        
        const result = await validatePath(newFilePath);
        expect(result).toBe(path.resolve(newFilePath));
      });

      it('rejects when parent directory does not exist', async () => {
        const newFilePath = process.platform === 'win32' ? 'C:\\Users\\test\\nonexistent\\newfile.txt' : '/home/user/nonexistent/newfile.txt';
        
        // Create errors with the ENOENT code
        const enoentError1 = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError1.code = 'ENOENT';
        const enoentError2 = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError2.code = 'ENOENT';
        
        mockFs.realpath
          .mockRejectedValueOnce(enoentError1)
          .mockRejectedValueOnce(enoentError2);
        
        await expect(validatePath(newFilePath))
          .rejects.toThrow('Parent directory does not exist');
      });
    });
  });

  describe('File Operations', () => {
    describe('getFileStats', () => {
      it('returns file statistics', async () => {
        const mockStats = {
          size: 1024,
          birthtime: new Date('2023-01-01'),
          mtime: new Date('2023-01-02'),
          atime: new Date('2023-01-03'),
          isDirectory: () => false,
          isFile: () => true,
          mode: 0o644
        };
        
        mockFs.stat.mockResolvedValueOnce(mockStats as any);
        
        const result = await getFileStats('/test/file.txt');
        
        expect(result).toEqual({
          size: 1024,
          created: new Date('2023-01-01'),
          modified: new Date('2023-01-02'),
          accessed: new Date('2023-01-03'),
          isDirectory: false,
          isFile: true,
          permissions: '644'
        });
      });

      it('handles directory statistics', async () => {
        const mockStats = {
          size: 4096,
          birthtime: new Date('2023-01-01'),
          mtime: new Date('2023-01-02'),
          atime: new Date('2023-01-03'),
          isDirectory: () => true,
          isFile: () => false,
          mode: 0o755
        };
        
        mockFs.stat.mockResolvedValueOnce(mockStats as any);
        
        const result = await getFileStats('/test/dir');
        
        expect(result.isDirectory).toBe(true);
        expect(result.isFile).toBe(false);
        expect(result.permissions).toBe('755');
      });
    });

    describe('readFileContent', () => {
      it('reads file with explicit encoding', async () => {
        mockFs.readFile.mockResolvedValueOnce('file content');
        
        const result = await readFileContent('/test/file.txt', 'utf-8');
        
        expect(result).toBe('file content');
        expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt', 'utf-8');
      });

      it('auto-detects encoding when not specified', async () => {
        const testText = 'Hello, world!';
        const buffer = Buffer.from(testText, 'utf-8');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/file.txt');
        
        expect(result).toBe(testText);
        // Should have called readFile without encoding (returns Buffer)
        expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt');
      });

      it('detects and decodes Windows-1253 encoded files', async () => {
        const greekText = 'Γεια σου';
        const buffer = iconv.encode(greekText, 'windows-1253');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/greek.txt');
        
        expect(result).toBe(greekText);
      });
    });

    describe('readFileContentWithEncoding', () => {
      it('returns content and detected encoding', async () => {
        const testText = 'Hello, world!';
        const buffer = Buffer.from(testText, 'utf-8');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContentWithEncoding('/test/file.txt');
        
        expect(result.content).toBe(testText);
        expect(result.encoding).toBe('utf-8');
      });

      it('detects Windows-1253 encoding', async () => {
        const greekText = 'Γεια σου';
        const buffer = iconv.encode(greekText, 'windows-1253');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContentWithEncoding('/test/greek.txt');
        
        expect(result.content).toBe(greekText);
        expect(result.encoding).toBe('windows-1253');
      });
    });

    describe('writeFileContent', () => {
      it('writes file content with default UTF-8 encoding', async () => {
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        
        await writeFileContent('/test/file.txt', 'new content');
        
        // Should write a Buffer encoded as UTF-8
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          '/test/file.txt',
          expect.any(Buffer),
          { flag: 'wx' }
        );
        
        // Verify the buffer contains the correct UTF-8 encoded content
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        expect(writtenBuffer.toString('utf-8')).toBe('new content');
      });

      it('writes file content with specified encoding', async () => {
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        
        const greekText = 'Γεια σου';
        await writeFileContent('/test/greek.txt', greekText, 'windows-1253');
        
        // Should write a Buffer encoded as windows-1253
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          '/test/greek.txt',
          expect.any(Buffer),
          { flag: 'wx' }
        );
        
        // Verify the buffer is correctly encoded
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        const expectedBuffer = iconv.encode(greekText, 'windows-1253');
        expect(writtenBuffer.equals(expectedBuffer)).toBe(true);
      });

      it('handles EEXIST with atomic rename and preserves encoding', async () => {
        const eexistError = new Error('EEXIST') as NodeJS.ErrnoException;
        eexistError.code = 'EEXIST';
        
        mockFs.writeFile
          .mockRejectedValueOnce(eexistError)
          .mockResolvedValueOnce(undefined);
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const greekText = 'Γεια σου';
        await writeFileContent('/test/greek.txt', greekText, 'windows-1253');
        
        // Should write to temp file then rename
        expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/greek\.txt\.[a-f0-9]+\.tmp$/),
          '/test/greek.txt'
        );
        
        // Verify encoding is preserved - second call has (tempPath, buffer)
        const secondCall = mockFs.writeFile.mock.calls[1];
        const writtenBuffer = secondCall[1]; // Second argument is the buffer
        const expectedBuffer = iconv.encode(greekText, 'windows-1253');
        expect(Buffer.isBuffer(writtenBuffer)).toBe(true);
        expect(Buffer.compare(writtenBuffer, expectedBuffer)).toBe(0);
      });
    });

  });

  describe('Search & Filtering Functions', () => {
    describe('searchFilesWithValidation', () => {
      beforeEach(() => {
        mockFs.realpath.mockImplementation(async (path: any) => path.toString());
      });


      it('excludes files matching exclude patterns', async () => {
        const mockEntries = [
          { name: 'test.txt', isDirectory: () => false },
          { name: 'test.log', isDirectory: () => false },
          { name: 'node_modules', isDirectory: () => true }
        ];
        
        mockFs.readdir.mockResolvedValueOnce(mockEntries as any);
        
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\dir' : '/allowed/dir';
        const allowedDirs = process.platform === 'win32' ? ['C:\\allowed'] : ['/allowed'];
        
        // Mock realpath to return the same path for validation to pass
        mockFs.realpath.mockImplementation(async (inputPath: any) => {
          const pathStr = inputPath.toString();
          // Return the path as-is for validation
          return pathStr;
        });
        
        const result = await searchFilesWithValidation(
          testDir,
          '*test*',
          allowedDirs,
          { excludePatterns: ['*.log', 'node_modules'] }
        );
        
        const expectedResult = process.platform === 'win32' ? 'C:\\allowed\\dir\\test.txt' : '/allowed/dir/test.txt';
        expect(result).toEqual([expectedResult]);
      });

      it('handles validation errors during search', async () => {
        const mockEntries = [
          { name: 'test.txt', isDirectory: () => false },
          { name: 'invalid_file.txt', isDirectory: () => false }
        ];
        
        mockFs.readdir.mockResolvedValueOnce(mockEntries as any);
        
        // Mock validatePath to throw error for invalid_file.txt
        mockFs.realpath.mockImplementation(async (path: any) => {
          if (path.toString().includes('invalid_file.txt')) {
            throw new Error('Access denied');
          }
          return path.toString();
        });
        
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\dir' : '/allowed/dir';
        const allowedDirs = process.platform === 'win32' ? ['C:\\allowed'] : ['/allowed'];
        
        const result = await searchFilesWithValidation(
          testDir,
          '*test*',
          allowedDirs,
          {}
        );
        
        // Should only return the valid file, skipping the invalid one
        const expectedResult = process.platform === 'win32' ? 'C:\\allowed\\dir\\test.txt' : '/allowed/dir/test.txt';
        expect(result).toEqual([expectedResult]);
      });

      it('handles complex exclude patterns with wildcards', async () => {
        const mockEntries = [
          { name: 'test.txt', isDirectory: () => false },
          { name: 'test.backup', isDirectory: () => false },
          { name: 'important_test.js', isDirectory: () => false }
        ];
        
        mockFs.readdir.mockResolvedValueOnce(mockEntries as any);
        
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\dir' : '/allowed/dir';
        const allowedDirs = process.platform === 'win32' ? ['C:\\allowed'] : ['/allowed'];
        
        const result = await searchFilesWithValidation(
          testDir,
          '*test*',
          allowedDirs,
          { excludePatterns: ['*.backup'] }
        );
        
        const expectedResults = process.platform === 'win32' ? [
          'C:\\allowed\\dir\\test.txt',
          'C:\\allowed\\dir\\important_test.js'
        ] : [
          '/allowed/dir/test.txt',
          '/allowed/dir/important_test.js'
        ];
        expect(result).toEqual(expectedResults);
      });
    });
  });

  describe('File Editing Functions', () => {
    describe('applyFileEdits', () => {
      beforeEach(() => {
        // Mock readFile to return a Buffer (auto-detect encoding)
        const testContent = 'line1\nline2\nline3\n';
        mockFs.readFile.mockResolvedValue(Buffer.from(testContent, 'utf-8'));
        mockFs.writeFile.mockResolvedValue(undefined);
      });

      it('applies simple text replacement and preserves UTF-8 encoding', async () => {
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const result = await applyFileEdits('/test/file.txt', edits, false);
        
        expect(result).toContain('modified line2');
        // Should write to temporary file as a Buffer then rename
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          expect.any(Buffer)
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });

      it('handles dry run mode', async () => {
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        const result = await applyFileEdits('/test/file.txt', edits, true);
        
        expect(result).toContain('modified line2');
        expect(mockFs.writeFile).not.toHaveBeenCalled();
      });

      it('applies multiple edits sequentially', async () => {
        const edits = [
          { oldText: 'line1', newText: 'first line' },
          { oldText: 'line3', newText: 'third line' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        expect(writtenBuffer.toString('utf-8')).toBe('first line\nline2\nthird line\n');
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });

      it('preserves Windows-1253 encoding when editing', async () => {
        const greekText = 'Γραμμή 1\nΓραμμή 2\nΓραμμή 3\n';
        const buffer = iconv.encode(greekText, 'windows-1253');
        mockFs.readFile.mockResolvedValue(buffer);
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const edits = [
          { oldText: 'Γραμμή 2', newText: 'Τροποποιημένη γραμμή 2' }
        ];
        
        await applyFileEdits('/test/greek.txt', edits, false);
        
        // Should write as windows-1253 encoded buffer
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        expect(Buffer.isBuffer(writtenBuffer)).toBe(true);
        
        // Decode and verify content
        const decodedContent = iconv.decode(writtenBuffer, 'windows-1253');
        expect(decodedContent).toContain('Τροποποιημένη γραμμή 2');
      });

      it('handles whitespace-flexible matching', async () => {
        mockFs.readFile.mockResolvedValue(Buffer.from('  line1\n    line2\n  line3\n', 'utf-8'));
        
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        expect(writtenBuffer.toString('utf-8')).toBe('  line1\n    modified line2\n  line3\n');
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });

      it('throws error for non-matching edits', async () => {
        const edits = [
          { oldText: 'nonexistent line', newText: 'replacement' }
        ];
        
        await expect(applyFileEdits('/test/file.txt', edits, false))
          .rejects.toThrow('Could not find exact match for edit');
      });

      it('handles complex multi-line edits with indentation', async () => {
        const content = 'function test() {\n  console.log("hello");\n  return true;\n}';
        mockFs.readFile.mockResolvedValue(Buffer.from(content, 'utf-8'));
        
        const edits = [
          { 
            oldText: '  console.log("hello");\n  return true;', 
            newText: '  console.log("world");\n  console.log("test");\n  return false;' 
          }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.js', edits, false);
        
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        expect(writtenBuffer.toString('utf-8')).toBe(
          'function test() {\n  console.log("world");\n  console.log("test");\n  return false;\n}'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          '/test/file.js'
        );
      });

      it('handles edits with different indentation patterns', async () => {
        const content = '    if (condition) {\n        doSomething();\n    }';
        mockFs.readFile.mockResolvedValue(Buffer.from(content, 'utf-8'));
        
        const edits = [
          { 
            oldText: 'doSomething();', 
            newText: 'doSomethingElse();\n        doAnotherThing();' 
          }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.js', edits, false);
        
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        expect(writtenBuffer.toString('utf-8')).toBe(
          '    if (condition) {\n        doSomethingElse();\n        doAnotherThing();\n    }'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          '/test/file.js'
        );
      });

      it('handles CRLF line endings in file content', async () => {
        mockFs.readFile.mockResolvedValue(Buffer.from('line1\r\nline2\r\nline3\r\n', 'utf-8'));
        
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        const writtenBuffer = mockFs.writeFile.mock.calls[0][1];
        expect(writtenBuffer.toString('utf-8')).toBe('line1\nmodified line2\nline3\n');
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });
    });

    describe('tailFile', () => {
      it('handles empty files', async () => {
        mockFs.stat.mockResolvedValue({ size: 0 } as any);
        
        const result = await tailFile('/test/empty.txt', 5);
        
        expect(result).toBe('');
        expect(mockFs.open).not.toHaveBeenCalled();
      });

      it('calls stat to check file size', async () => {
        mockFs.stat.mockResolvedValue({ size: 100 } as any);
        
        // Mock file handle with proper typing
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        mockFileHandle.read.mockResolvedValue({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        await tailFile('/test/file.txt', 2);
        
        expect(mockFs.stat).toHaveBeenCalledWith('/test/file.txt');
        expect(mockFs.open).toHaveBeenCalledWith('/test/file.txt', 'r');
      });

      it('handles files with content and returns last lines', async () => {
        mockFs.stat.mockResolvedValue({ size: 50 } as any);
        
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading file content in chunks
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 20, buffer: Buffer.from('line3\nline4\nline5\n') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await tailFile('/test/file.txt', 2);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });

      it('handles read errors gracefully', async () => {
        mockFs.stat.mockResolvedValue({ size: 100 } as any);
        
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        mockFileHandle.read.mockResolvedValue({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        await tailFile('/test/file.txt', 5);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });
    });

    describe('headFile', () => {
      it('opens file for reading', async () => {
        // Mock file handle with proper typing
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        mockFileHandle.read.mockResolvedValue({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        await headFile('/test/file.txt', 2);
        
        expect(mockFs.open).toHaveBeenCalledWith('/test/file.txt', 'r');
      });

      it('handles files with content and returns first lines', async () => {
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading file content with newlines
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 20, buffer: Buffer.from('line1\nline2\nline3\n') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await headFile('/test/file.txt', 2);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });

      it('handles files with leftover content', async () => {
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading file content without final newline
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 15, buffer: Buffer.from('line1\nline2\nend') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await headFile('/test/file.txt', 5);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });

      it('handles reaching requested line count', async () => {
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading exactly the requested number of lines
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 12, buffer: Buffer.from('line1\nline2\n') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await headFile('/test/file.txt', 2);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });
    });
  });
});

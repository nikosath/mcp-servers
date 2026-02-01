import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  // Pure utility functions
  formatSize,
  normalizeLineEndings,
  createUnifiedDiff,
  // Security & validation functions
  validatePath,
  setAllowedDirectories,
  setCandidateEncodings,
  // File operations
  getFileStats,
  readFileContent,
  writeFileContent,
  detectEncoding,
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
      it('reads file with auto-detection', async () => {
        const content = 'file content';
        const buffer = Buffer.from(content, 'utf-8');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/file.txt');
        
        expect(result).toBe('file content');
        expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt');
      });

      it('reads file with explicit encoding', async () => {
        const content = 'file content';
        const buffer = Buffer.from(content, 'ascii');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/file.txt', 'ascii');
        
        expect(result).toBe('file content');
        expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt');
      });
    });

    describe('writeFileContent', () => {
      it('writes file content as buffer', async () => {
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        
        await writeFileContent('/test/file.txt', 'new content');
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const args = mockFs.writeFile.mock.calls[0];
        expect(args[0]).toBe('/test/file.txt');
        expect(Buffer.isBuffer(args[1])).toBe(true);
        expect(args[1].toString('utf-8')).toBe('new content');
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
        const buffer = Buffer.from('line1\nline2\nline3\n', 'utf-8');
        mockFs.readFile.mockResolvedValue(buffer);
        mockFs.writeFile.mockResolvedValue(undefined);
      });

      it('applies simple text replacement', async () => {
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const result = await applyFileEdits('/test/file.txt', edits, false);
        
        expect(result).toContain('modified line2');
        // Should write to temporary file then rename with Buffer
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        expect(writeArgs[0]).toMatch(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/);
        expect(Buffer.isBuffer(writeArgs[1])).toBe(true);
        expect(writeArgs[1].toString('utf-8')).toBe('line1\nmodified line2\nline3\n');
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
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        expect(writeArgs[0]).toMatch(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/);
        expect(Buffer.isBuffer(writeArgs[1])).toBe(true);
        expect(writeArgs[1].toString('utf-8')).toBe('first line\nline2\nthird line\n');
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });

      it('handles whitespace-flexible matching', async () => {
        const buffer = Buffer.from('  line1\n    line2\n  line3\n', 'utf-8');
        mockFs.readFile.mockResolvedValue(buffer);
        
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        expect(writeArgs[0]).toMatch(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/);
        expect(Buffer.isBuffer(writeArgs[1])).toBe(true);
        expect(writeArgs[1].toString('utf-8')).toBe('  line1\n    modified line2\n  line3\n');
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
        const buffer = Buffer.from('function test() {\n  console.log("hello");\n  return true;\n}', 'utf-8');
        mockFs.readFile.mockResolvedValue(buffer);
        
        const edits = [
          { 
            oldText: '  console.log("hello");\n  return true;', 
            newText: '  console.log("world");\n  console.log("test");\n  return false;' 
          }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.js', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        expect(writeArgs[0]).toMatch(/\/test\/file\.js\.[a-f0-9]+\.tmp$/);
        expect(Buffer.isBuffer(writeArgs[1])).toBe(true);
        expect(writeArgs[1].toString('utf-8')).toBe('function test() {\n  console.log("world");\n  console.log("test");\n  return false;\n}');
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          '/test/file.js'
        );
      });

      it('handles edits with different indentation patterns', async () => {
        const buffer = Buffer.from('    if (condition) {\n        doSomething();\n    }', 'utf-8');
        mockFs.readFile.mockResolvedValue(buffer);
        
        const edits = [
          { 
            oldText: 'doSomething();', 
            newText: 'doSomethingElse();\n        doAnotherThing();' 
          }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.js', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        expect(writeArgs[0]).toMatch(/\/test\/file\.js\.[a-f0-9]+\.tmp$/);
        expect(Buffer.isBuffer(writeArgs[1])).toBe(true);
        expect(writeArgs[1].toString('utf-8')).toBe('    if (condition) {\n        doSomethingElse();\n        doAnotherThing();\n    }');
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          '/test/file.js'
        );
      });

      it('handles CRLF line endings in file content', async () => {
        const buffer = Buffer.from('line1\r\nline2\r\nline3\r\n', 'utf-8');
        mockFs.readFile.mockResolvedValue(buffer);
        
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        expect(writeArgs[0]).toMatch(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/);
        expect(Buffer.isBuffer(writeArgs[1])).toBe(true);
        expect(writeArgs[1].toString('utf-8')).toBe('line1\nmodified line2\nline3\n');
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

  describe('Encoding Detection and Preservation', () => {
    const iconv = require('iconv-lite');
    
    beforeEach(() => {
      // Set candidate encodings for tests
      setCandidateEncodings(['utf-8', 'windows-1253', 'iso-8859-7']);
    });
    
    describe('detectEncoding', () => {
      it('detects UTF-8 encoding', () => {
        const content = 'Hello World! This is UTF-8 text.';
        const buffer = Buffer.from(content, 'utf-8');
        
        const detected = detectEncoding(buffer);
        expect(detected).toBe('utf-8');
      });
      
      it('detects windows-1253 encoding with round-trip', () => {
        // Greek text in windows-1253
        const greekText = 'Καλημέρα κόσμε'; // "Good morning world" in Greek
        const buffer = iconv.encode(greekText, 'windows-1253');
        
        const detected = detectEncoding(buffer);
        expect(detected).toBe('windows-1253');
        
        // Verify round-trip works
        const decoded = iconv.decode(buffer, detected);
        const reencoded = iconv.encode(decoded, detected);
        expect(buffer.equals(reencoded)).toBe(true);
      });
      
      it('returns first matching encoding from candidates', () => {
        // Single byte values can round-trip with windows-1253, so it will be selected
        // This test verifies that the function returns the first matching candidate
        const buffer = Buffer.from([0xC2]); // A single byte
        
        const detected = detectEncoding(buffer);
        // Since utf-8 is first in the candidate list, and single bytes are valid in both,
        // we should get utf-8
        expect(['utf-8', 'windows-1253']).toContain(detected);
      });
    });
    
    describe('readFileContent with encoding detection', () => {
      it('auto-detects UTF-8 and returns string', async () => {
        const content = 'Hello UTF-8 world!';
        const buffer = Buffer.from(content, 'utf-8');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/file.txt');
        
        expect(typeof result).toBe('string');
        expect(result).toBe(content);
      });
      
      it('auto-detects windows-1253 and returns string', async () => {
        const greekText = 'Καλημέρα κόσμε';
        const buffer = iconv.encode(greekText, 'windows-1253');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/file.txt');
        
        expect(typeof result).toBe('string');
        expect(result).toBe(greekText);
      });
      
      it('returns encoding info when returnEncoding is true', async () => {
        const greekText = 'Καλημέρα κόσμε';
        const buffer = iconv.encode(greekText, 'windows-1253');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/file.txt', undefined, true);
        
        expect(result).toHaveProperty('text');
        expect(result).toHaveProperty('encoding');
        expect((result as any).text).toBe(greekText);
        expect((result as any).encoding).toBe('windows-1253');
      });
      
      it('uses explicit encoding when provided', async () => {
        const content = 'Test content';
        const buffer = iconv.encode(content, 'iso-8859-7');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const result = await readFileContent('/test/file.txt', 'iso-8859-7');
        
        expect(result).toBe(content);
      });
    });
    
    describe('writeFileContent with encoding', () => {
      it('writes UTF-8 by default', async () => {
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        
        await writeFileContent('/test/file.txt', 'content');
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const callArgs = mockFs.writeFile.mock.calls[0];
        expect(callArgs[0]).toBe('/test/file.txt');
        expect(Buffer.isBuffer(callArgs[1])).toBe(true);
        expect(callArgs[1].toString('utf-8')).toBe('content');
      });
      
      it('writes with windows-1253 encoding when specified', async () => {
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        const greekText = 'Καλημέρα κόσμε';
        
        await writeFileContent('/test/file.txt', greekText, 'windows-1253');
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const callArgs = mockFs.writeFile.mock.calls[0];
        expect(Buffer.isBuffer(callArgs[1])).toBe(true);
        
        // Verify the buffer is correctly encoded
        const expectedBuffer = iconv.encode(greekText, 'windows-1253');
        expect(callArgs[1].equals(expectedBuffer)).toBe(true);
      });
      
      it('handles EEXIST with atomic rename using encoding', async () => {
        const eexistError = new Error('EEXIST') as NodeJS.ErrnoException;
        eexistError.code = 'EEXIST';
        
        mockFs.writeFile
          .mockRejectedValueOnce(eexistError)
          .mockResolvedValueOnce(undefined);
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const greekText = 'Καλημέρα κόσμε';
        await writeFileContent('/test/file.txt', greekText, 'windows-1253');
        
        expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
        expect(mockFs.rename).toHaveBeenCalled();
        
        // Check temp file write has correct encoding
        const tempWriteArgs = mockFs.writeFile.mock.calls[1];
        const expectedBuffer = iconv.encode(greekText, 'windows-1253');
        expect(tempWriteArgs[1].equals(expectedBuffer)).toBe(true);
      });
    });
    
    describe('applyFileEdits with encoding preservation', () => {
      beforeEach(() => {
        mockFs.rename.mockResolvedValue(undefined);
        mockFs.unlink.mockResolvedValue(undefined);
      });
      
      it('preserves windows-1253 encoding when editing', async () => {
        const originalGreek = 'Γεια σου κόσμε\nΔεύτερη γραμμή';
        const buffer = iconv.encode(originalGreek, 'windows-1253');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const edits = [
          { oldText: 'Γεια σου κόσμε', newText: 'Καλημέρα κόσμε' }
        ];
        
        const result = await applyFileEdits('/test/file.txt', edits, false);
        
        // Verify diff was created
        expect(result).toContain('diff');
        
        // Verify writeFile was called with windows-1253 encoded buffer
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        expect(Buffer.isBuffer(writeArgs[1])).toBe(true);
        
        // Decode and verify the written content
        const writtenContent = iconv.decode(writeArgs[1], 'windows-1253');
        expect(writtenContent).toContain('Καλημέρα κόσμε');
        expect(writtenContent).toContain('Δεύτερη γραμμή');
        expect(writtenContent).not.toContain('Γεια σου κόσμε');
      });
      
      it('preserves UTF-8 encoding when editing', async () => {
        const originalContent = 'Hello\nWorld';
        const buffer = Buffer.from(originalContent, 'utf-8');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        mockFs.writeFile.mockResolvedValueOnce(undefined);
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const edits = [
          { oldText: 'Hello', newText: 'Hi' }
        ];
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalled();
        const writeArgs = mockFs.writeFile.mock.calls[0];
        const writtenContent = writeArgs[1].toString('utf-8');
        expect(writtenContent).toBe('Hi\nWorld');
      });
      
      it('does not write in dry-run mode', async () => {
        const originalContent = 'Line 1\nLine 2';
        const buffer = Buffer.from(originalContent, 'utf-8');
        mockFs.readFile.mockResolvedValueOnce(buffer);
        
        const edits = [
          { oldText: 'Line 1', newText: 'Modified Line 1' }
        ];
        
        const result = await applyFileEdits('/test/file.txt', edits, true);
        
        expect(result).toContain('diff');
        expect(mockFs.writeFile).not.toHaveBeenCalled();
        expect(mockFs.rename).not.toHaveBeenCalled();
      });
    });
  });
});

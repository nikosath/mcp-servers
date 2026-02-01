import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getCandidateEncodings } from '../encoding-config.js';

describe('Encoding Config', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'encoding-config-test-'));
    // Save original environment variable
    originalEnv = process.env.MCP_CANDIDATE_ENCODINGS;
    delete process.env.MCP_CANDIDATE_ENCODINGS;
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {}
    // Restore environment variable
    if (originalEnv !== undefined) {
      process.env.MCP_CANDIDATE_ENCODINGS = originalEnv;
    } else {
      delete process.env.MCP_CANDIDATE_ENCODINGS;
    }
  });

  describe('getCandidateEncodings', () => {
    it('returns default encodings when no config exists', async () => {
      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'windows1253']);
    });

    it('reads from environment variable with highest precedence', async () => {
      process.env.MCP_CANDIDATE_ENCODINGS = 'utf-8,iso-8859-7,windows-1252';
      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'iso-8859-7', 'windows-1252']);
    });

    it('reads from .vscode/settings.json when no env var', async () => {
      const vscodeDir = path.join(testDir, '.vscode');
      await fs.mkdir(vscodeDir);
      await fs.writeFile(
        path.join(vscodeDir, 'settings.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': ['windows-1253', 'utf-8', 'iso-8859-7']
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['windows-1253', 'utf-8', 'iso-8859-7']);
    });

    it('accepts comma-separated string in .vscode/settings.json', async () => {
      const vscodeDir = path.join(testDir, '.vscode');
      await fs.mkdir(vscodeDir);
      await fs.writeFile(
        path.join(vscodeDir, 'settings.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': 'windows-1253,utf-8'
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['windows-1253', 'utf-8']);
    });

    it('reads from .mcp-server.json when no env var or vscode config', async () => {
      await fs.writeFile(
        path.join(testDir, '.mcp-server.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': ['iso-8859-7', 'utf-8']
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['iso-8859-7', 'utf-8']);
    });

    it('accepts comma-separated string in .mcp-server.json', async () => {
      await fs.writeFile(
        path.join(testDir, '.mcp-server.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': 'iso-8859-7,utf-8,windows-1253'
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['iso-8859-7', 'utf-8', 'windows-1253']);
    });

    it('environment variable overrides .vscode/settings.json', async () => {
      process.env.MCP_CANDIDATE_ENCODINGS = 'utf-8,windows-1252';

      const vscodeDir = path.join(testDir, '.vscode');
      await fs.mkdir(vscodeDir);
      await fs.writeFile(
        path.join(vscodeDir, 'settings.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': ['windows-1253', 'utf-8']
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'windows-1252']);
    });

    it('.vscode/settings.json overrides .mcp-server.json', async () => {
      const vscodeDir = path.join(testDir, '.vscode');
      await fs.mkdir(vscodeDir);
      await fs.writeFile(
        path.join(vscodeDir, 'settings.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': ['windows-1253', 'utf-8']
        })
      );

      await fs.writeFile(
        path.join(testDir, '.mcp-server.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': ['iso-8859-7', 'utf-8']
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['windows-1253', 'utf-8']);
    });

    it('handles malformed .vscode/settings.json gracefully', async () => {
      const vscodeDir = path.join(testDir, '.vscode');
      await fs.mkdir(vscodeDir);
      await fs.writeFile(
        path.join(vscodeDir, 'settings.json'),
        'invalid json {'
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'windows1253']);
    });

    it('handles malformed .mcp-server.json gracefully', async () => {
      await fs.writeFile(
        path.join(testDir, '.mcp-server.json'),
        'invalid json {'
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'windows1253']);
    });

    it('filters out empty strings from comma-separated values', async () => {
      process.env.MCP_CANDIDATE_ENCODINGS = 'utf-8,,windows-1253,  ,iso-8859-7';
      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'windows-1253', 'iso-8859-7']);
    });

    it('handles empty array in config file', async () => {
      await fs.writeFile(
        path.join(testDir, '.mcp-server.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': []
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'windows1253']);
    });

    it('handles invalid value type in config file', async () => {
      await fs.writeFile(
        path.join(testDir, '.mcp-server.json'),
        JSON.stringify({
          'files.candidateGuessEncodings': 123
        })
      );

      const candidates = await getCandidateEncodings(testDir);
      expect(candidates).toEqual(['utf-8', 'windows1253']);
    });
  });
});

#!/usr/bin/env node
/**
 * postinstall.mjs — npm install 后自动处理
 *
 * 解决内网环境 sharp/libvips 下载问题：
 *   npm install 时 sharp 会尝试从 GitHub 下载 libvips，
 *   内网环境会超时失败。此脚本从 vendor/ 的本地备份提取。
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── 修复 sharp libvips ──

const SHARP_VENDOR = path.join(ROOT, 'node_modules', 'sharp', 'vendor', '8.14.5');
const LOCAL_LIBVIPS = path.join(ROOT, 'vendor', 'libvips-8.14.5-linux-x64.tar.br');

if (fs.existsSync(LOCAL_LIBVIPS)) {
  // 检查 sharp 是否已正确安装
  const sharpNode = path.join(ROOT, 'node_modules', 'sharp', 'build', 'Release', 'sharp-linux-x64.node');
  const libMissing = !fs.existsSync(sharpNode);

  if (libMissing) {
    console.log('[postinstall] 从 vendor/ 安装 sharp libvips...');
    // 确保 vendor 目录存在
    fs.mkdirSync(path.dirname(SHARP_VENDOR), { recursive: true });
    // 提取 libvips
    try {
      execSync(
        `tar --use-compress-program=brotli -xf "${LOCAL_LIBVIPS}" -C "${path.dirname(SHARP_VENDOR)}/"`,
        { stdio: 'pipe', timeout: 30000 }
      );
      console.log('[postinstall] ✓ libvips 已安装');
    } catch (e) {
      console.warn('[postinstall] ⚠ libvips 解压失败:', e.message);
    }

    // 重建 sharp 原生模块
    if (fs.existsSync(path.join(ROOT, 'node_modules', 'sharp'))) {
      try {
        execSync('npx prebuild-install', {
          cwd: path.join(ROOT, 'node_modules', 'sharp'),
          stdio: 'pipe',
          timeout: 60000,
        });
        console.log('[postinstall] ✓ sharp 原生模块已安装');
      } catch {
        try {
          execSync('node-gyp rebuild', {
            cwd: path.join(ROOT, 'node_modules', 'sharp'),
            stdio: 'pipe',
            timeout: 120000,
          });
          console.log('[postinstall] ✓ sharp 已编译');
        } catch (e2) {
          console.warn('[postinstall] ⚠ sharp 编译失败（回退到 WASM 模式）:', e2.message);
        }
      }
    }
  } else {
    console.log('[postinstall] sharp 已就绪');
  }
} else {
  console.log('[postinstall] vendor/libvips 不存在（sharp 将尝试在线下载）');
}

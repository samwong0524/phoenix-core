---
name: comfyui-basics
description: ComfyUI 基础使用指南：节点系统、模型、工作流制作
auto-load: true
---
# ComfyUI 使用指南

## 一、什么是 ComfyUI

ComfyUI 是一个基于节点/图界面的 Stable Diffusion 和其他 AI 模型的工作流引擎。与 WebUI 不同，它不需要写代码，通过拖拽节点连接即可创建复杂的工作流。

**核心优势：**
- 节点化界面，可视化编排
- 只执行变化的部分，节省时间
- 智能内存管理，低显存也能运行大模型
- 支持图片、视频、3D、音频等多种模态
- 可保存/加载完整工作流为 JSON 文件

## 二、ComfyUI 目录结构

```
ComfyUI/
├── models/
│   ├── checkpoints/        # 主模型（.ckpt, .safetensors）
│   ├── vae/               # VAE 模型
│   ├── loras/             # LoRA 模型
│   ├── embeddings/         # 文本反转嵌入
│   ├── controlnet/        # ControlNet 模型
│   ├── upscale_models/    # 超分模型 (ESRGAN, SwinIR 等)
│   ├── clip/              # CLIP 文本编码器
│   ├── clip_vision/       # CLIP 视觉编码器
│   ├── unet/              # UNet 扩散模型
│   ├── vae_approx/        # 预览用 TAESD 解码器
│   └── ...
├── custom_nodes/           # 自定义节点
├── input/                  # 输入图片
├── output/                 # 输出图片
└── user/                   # 用户保存的工作流
```

## 三、核心节点类型与用法

### 1. 基础文生图工作流节点

一个最基础的文生图工作流需要以下节点：

#### Load Checkpoint（加载检查点）
- **功能**：加载 SD/SDXL/Flux 等主模型
- **输入**：无
- **输出**：MODEL, CLIP, VAE
- **说明**：这是工作流的起点，选择 .safetensors 或 .ckpt 模型文件

#### CLIP Text Encode (Prompt)（文本编码）
- **功能**：将文本提示词转换为模型可理解的向量
- **需要两个**：一个用于正向提示词（positive），一个用于负向提示词（negative）
- **输入**：CLIP（来自 Load Checkpoint）
- **输出**：CONDITIONING
- **技巧**：支持 `(word:1.2)` 加强权重，`[word1|word2]` 随机选择

#### Empty Latent Image（空潜空间图像）
- **功能**：创建指定尺寸的空白潜空间
- **参数**：width, height, batch_size
- **常用尺寸**：
  - SD1.5: 512×512, 512×768, 768×512
  - SDXL: 1024×1024, 896×1152, 1152×896
  - Flux: 1024×1024 或任意比例

#### KSampler（K 采样器）
- **功能**：核心去噪/生成节点
- **输入**：model, positive, negative, latent_image
- **关键参数**：
  - `seed`: 随机种子（固定可复现）
  - `steps`: 采样步数（20-40 通常足够）
  - `cfg`: CFG 引导强度（SD 7-8, Flux 1.5-3.5）
  - `sampler_name`: 采样器（euler_a, dpm++_2m, dpmpp_sde 等）
  - `scheduler`: 调度器（normal, karras, exponential）
  - `denoise`: 去噪强度（1.0=完全生成，0.5=半保留原图）

#### VAE Decode（VAE 解码）
- **功能**：将潜空间图像解码为像素图像
- **输入**：samples（来自 KSampler）, vae（来自 Load Checkpoint）
- **输出**：IMAGE

#### Save Image（保存图像）
- **功能**：保存生成的图片
- **输入**：images（来自 VAE Decode）

### 2. 常用高级节点

#### Load LoRA
- **功能**：加载 LoRA 微调模型
- **用法**：串联在 Load Checkpoint 和 CLIP Text Encode 之间
- **输入**：MODEL, CLIP → 输出 MODEL, CLIP

#### ControlNet Apply
- **功能**：使用 ControlNet 控制构图/姿态/深度等
- **需要**：ControlNet 模型 + 预处理器（如 OpenPose, Depth, Canny）

#### Upscale Image / Latent Upscale
- **功能**：放大图片
- **Latent Upscale**：在潜空间放大，需配合二次采样
- **Pixel Upscale**：使用超分模型放大

#### Image to Noise / Load Image
- **功能**：加载输入图片用于图生图

#### Conditioning（条件控制）
- **Conditioning Set Area**：区域提示词
- **Conditioning Concat**：拼接条件
- **Conditioning Zero Out**：归零条件

#### Reroute / Primitive
- **功能**：线路整理，避免连线混乱
- **Primitive**：创建可编辑的参数节点

## 四、常见模型类型

### 1. 图像生成模型（按架构分类）

| 模型 | 特点 | 推荐场景 |
|------|------|---------|
| **SD1.5** | 经典、资源消耗低、生态丰富 | 入门、快速出图、动漫 |
| **SDXL** | 高质量、原生 1024px | 写实照片、商业设计 |
| **SD3/SD3.5** | 多模态、文字生成能力强 | 含文字的海报、复杂构图 |
| **Flux** | 当前最强开源、提示词遵循度极高 | 专业设计、复杂指令 |
| **Flux 2** | Flux 升级版 | 更高质量 |
| **Hunyuan** | 腾讯混元、中文理解好 | 中文提示词 |
| **Qwen Image** | 阿里通义 | 中文场景 |

### 2. VAE（变分自编码器）
- **作用**：潜空间与像素空间的转换
- **注意**：不同模型需要匹配的 VAE
- **常用**：vae-ft-mse-840000（SD1.5 通用）、sdxl_vae.safetensors

### 3. LoRA（低秩适配）
- **作用**：轻量级微调，不改变主模型
- **权重**：通常 0.5-1.0 之间调整
- **类型**：画风 LoRA、人物 LoRA、概念 LoRA

### 4. ControlNet
- **作用**：通过输入图控制生成结果
- **类型**：
  - Canny：边缘线稿控制
  - Depth：深度图控制
  - OpenPose：姿态控制
  - Reference：参考图风格迁移

### 5. 超分模型
- **ESRGAN / RealESRGAN**：通用超分
- **SwinIR / Swin2SR**：细节增强
- **4x-UltraSharp**：清晰度高

## 五、如何制作工作流

### 步骤 1：明确目标
确定你要做什么：文生图、图生图、高清放大、人物换装、风格迁移等。

### 步骤 2：选择模型
根据需求选择主模型：
- 写实 → SDXL / Flux
- 动漫 → SD1.5 动漫模型
- 含文字 → SD3.5 / Flux
- 中文提示 → Hunyuan / Qwen

### 步骤 3：搭建基础骨架

**文生图最小工作流：**
```
Load Checkpoint
    ├── MODEL ─→ KSampler
    ├── CLIP ─→ CLIP Text Encode (positive) ─→ KSampler
    │         ─→ CLIP Text Encode (negative) ─→ KSampler
    └── VAE ─→ VAE Decode ← KSampler
                              ─→ Save Image

Empty Latent Image ─→ KSampler
```

### 步骤 4：逐步添加功能
- 要加 LoRA：在 Load Checkpoint 和 KSampler 之间插入 Load LoRA
- 要加 ControlNet：添加 ControlNet Apply 节点，连接到 KSampler
- 要高清放大：添加二阶采样（Hires Fix 流程）

### 步骤 5：优化与保存
- 整理连线，使用 Reroute 节点
- 测试不同参数组合
- Ctrl+S 保存工作流为 JSON

## 六、常用工作流模式

### 1. 基础文生图（txt2img）
最简单的流程，见上方骨架。

### 2. 图生图（img2img）
```
Load Image → VAE Encode → KSampler(denoise<1.0) → VAE Decode → Save Image
```

### 3. Hires Fix（高清修复）
```
一阶生成（低分辨率）→ Latent Upscale → 二阶 KSampler(denoise 0.3-0.5) → VAE Decode
```

### 4. 局部重绘（Inpainting）
```
Load Image → Load Mask → Inpaint Model → VAE Encode (with mask) → KSampler → VAE Decode
```

### 5. ControlNet 工作流
```
Load Image → ControlNet Preprocessor → ControlNet Apply → KSampler
```

### 6. 多图混合 / 风格迁移
```
多个 Load Image → 各自的 VAE Encode → 条件混合 → KSampler
```

## 七、ComfyUI API 调用

### 通过 API 队列任务
```python
import requests, json

# 1. 加载工作流
with open('workflow.json') as f:
    workflow = json.load(f)

# 2. 修改提示词
workflow["6"]["inputs"]["text"] = "your prompt"
workflow["5"]["inputs"]["text"] = "negative prompt"

# 3. 发送到 API
requests.post('http://127.0.0.1:8188/prompt', json={"prompt": workflow})

# 4. 获取历史/结果
history = requests.get('http://127.0.0.1:8188/history').json()
```

### 通过浏览器操作
1. 打开 `http://localhost:8188`
2. 双击空白处搜索添加节点
3. 拖拽连线连接节点输出到输入
4. Ctrl+Enter 执行
5. Ctrl+S 保存工作流

## 八、快捷键速查

| 快捷键 | 功能 |
|--------|------|
| Ctrl+Enter | 执行当前工作流 |
| Ctrl+Shift+Enter | 优先执行 |
| Ctrl+Z / Ctrl+Y | 撤销/重做 |
| Ctrl+S | 保存工作流 |
| Ctrl+O | 加载工作流 |
| 双击左键 | 快速搜索添加节点 |
| Ctrl+C / Ctrl+V | 复制粘贴节点 |
| Delete | 删除选中节点 |
| Alt+C | 折叠/展开节点 |
| Ctrl+M | 静音节点 |
| Ctrl+B | 绕过节点 |
| Ctrl+G | 组合节点 |
| Q | 切换队列显示 |
| H | 切换历史显示 |
| . | 适配视图到选中内容 |

## 九、安装自定义节点

### 方式 1：ComfyUI Manager
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ltdrdata/ComfyUI-Manager.git
cd ..
pip install -r custom_nodes/ComfyUI-Manager/manager_requirements.txt
python main.py --enable-manager
```

### 方式 2：手动安装
```bash
cd ComfyUI/custom_nodes
git clone <repository_url>
pip install -r requirements.txt  # 如果有
```

### 常用推荐自定义节点
- **ComfyUI-Impact-Pack**：面部修复、细节增强
- **ComfyUI-Advanced-ControlNet**：高级 ControlNet
- **ComfyUI-Custom-Scripts**：实用脚本合集
- **ComfyUI-Easy-Use**：简化操作
- **ComfyUI-Manager**：节点管理器（必备）

## 十、故障排查

| 问题 | 解决方案 |
|------|---------|
| 模型加载失败 | 检查模型是否放在正确目录 |
| 显存不足 | 使用 --lowvram 或减小图片尺寸 |
| 缺少节点 | 安装对应的自定义节点 |
| 输出全黑 | 检查 VAE 是否匹配模型 |
| 生成质量差 | 调整 CFG、步数、采样器 |
| 连线混乱 | 使用 Reroute 节点整理 |
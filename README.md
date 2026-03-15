# ScriptureFlow

**AI-powered worship display that listens to your preacher and puts scripture on screen — automatically.**

ScriptureFlow uses live speech recognition to detect Bible references as your pastor speaks, then instantly displays the verse on a connected screen or broadcast output. No manual searching. No keyboard shortcuts. Just preach.

---

## Download

👉 **[Download the latest installer (.exe)](https://github.com/Tioluwanilowo/scriptureflow/releases/latest)**

Windows 64-bit only. Run the installer and ScriptureFlow will appear in your Start Menu and on your Desktop.

---

## How It Works

1. ScriptureFlow listens to the microphone in real time
2. When the pastor says **"turn to John 3:16"** or **"chapter 15 verse 7"**, the app detects it
3. The verse is instantly displayed on your live output screen
4. The operator can approve, navigate (next/previous verse), or clear the display at any time

### Detection methods
| Method | Speed | Description |
|--------|-------|-------------|
| **Fast-path** | ~0 ms | Regex match on normalised transcript — catches explicit references like "John 3:16" deterministically |
| **AI batch** | ~300–600 ms | GPT-4o-mini interprets natural speech — handles "chapter 15", "next verse", "go back" |
| **Content match** | ~5 ms | Inverted-index search across 31,000 verses — suggests a verse when the preacher *quotes* scripture without naming it |

---

## Setup

### 1. API Keys required

| Key | Where to get it | Used for |
|-----|----------------|----------|
| **OpenAI** | [platform.openai.com](https://platform.openai.com) | AI interpretation (GPT-4o-mini) |
| **Deepgram** | [console.deepgram.com](https://console.deepgram.com) | Live speech-to-text |

Enter both keys in **Settings → Audio & Transcription** after launching the app.

### 2. Output screen
- Connect a second monitor or TV to your computer
- In **Settings → Live Output**, click **Open Window** and drag it to the second screen
- Press **F11** in that window to go full screen

---

## Operator Controls

| Action | How |
|--------|-----|
| Approve detected verse | Click **Approve** in the panel, or set mode to **Auto** |
| Push to live display | Auto mode does this instantly; Manual mode requires one click |
| Next / Previous verse | Arrow buttons or keyboard shortcuts |
| Clear screen | **Clear** button |
| Review suggestions | **Suggestions** column — verses inferred from spoken content |

---

## Running from Source (Developers)

**Prerequisites:** Node.js 20+, npm

```bash
# 1. Clone the repo
git clone https://github.com/Tioluwanilowo/scriptureflow.git
cd scriptureflow

# 2. Install dependencies
npm install

# 3. Download Bible data
npm run setup-bibles

# 4. Create a .env file and add your OpenAI key
echo "OPENAI_API_KEY=sk-..." > .env

# 5. Start the Electron app in dev mode
npm run electron:dev
```

---

## Releasing a New Version

```bash
# Bump version in package.json, then:
git add package.json
git commit -m "Release v1.x.x"
git push
git tag v1.x.x
git push origin v1.x.x
```

GitHub Actions builds the Windows installer automatically and publishes it to Releases.

---

## Tech Stack

- **Electron** — desktop app shell
- **React + Vite** — UI
- **Zustand** — state management
- **Deepgram** — streaming speech-to-text
- **OpenAI GPT-4o-mini** — natural language interpretation
- **Tailwind CSS** — styling

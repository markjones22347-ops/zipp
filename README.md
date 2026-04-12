# 📦 Zipp — No-Signup File Hosting

A clean, modern file hosting service with zero signup required. Upload files with custom display names, descriptions, expiration dates, and personalized links.

![Zipp Screenshot](https://via.placeholder.com/800x400/667eea/ffffff?text=Zipp+File+Hosting)

## ✨ Features

- **No Signup Required** — Upload files instantly without creating an account
- **Custom Display Names** — Give your uploads meaningful names
- **Descriptions** — Add context to your shared files
- **Flexible Expiry Options** — 1 day, 1 week, 1 month, never, or custom date/time
- **Custom Links** — Create memorable URLs like `/d/my-project`
- **Clean, Animated UI** — Modern design with smooth transitions
- **Download Tracking** — See how many times your files are downloaded
- **Automatic Cleanup** — Expired files are automatically removed
- **Session History** — Recent uploads stored in your browser session

## 🚀 Quick Start

```bash
# Clone or download the project
cd zipp-file-hosting

# Install dependencies
npm install

# Start the server
npm start
```

Then open http://localhost:3000 in your browser.

On Windows, you can also use the provided batch scripts:

```bash
# Development server (keeps window open)
.\scripts\dev.bat

# Git push helper
.\scripts\push.bat "Your commit message"
```

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **File Uploads**: Multer
- **Frontend**: Vanilla JavaScript + CSS3
- **No paid APIs or external services required**

## 📁 Project Structure

```
/
├── server/
│   ├── index.js      # Main server entry point
│   ├── routes.js     # API routes and download handlers
│   ├── db.js         # Database operations
│   └── cleanup.js    # Expired file cleanup script
├── public/
│   ├── index.html    # Main application page
│   ├── styles.css    # All styling
│   └── app.js        # Frontend logic
├── db/
│   ├── schema.sql    # Database schema
│   └── zipp.db       # SQLite database (auto-generated)
├── uploads/          # Uploaded files storage
├── scripts/
│   ├── dev.bat       # Development server launcher
│   └── push.bat      # Git push helper
└── package.json
```

## 🔌 API Endpoints

### Upload File
```bash
POST /api/upload
Content-Type: multipart/form-data

Parameters:
  - file: File (required, max 100MB)
  - display_name: string (required)
  - description: string (optional)
  - expiry_option: 'one_day' | 'one_week' | 'one_month' | 'never' | 'custom'
  - custom_expiry: ISO datetime (required if expiry_option is 'custom')
  - custom_slug: string (optional, 3-50 chars, a-zA-Z0-9_-)
```

### Get File Info
```bash
GET /api/file/:hash
```

### Download File
```bash
GET /d/:hash
```

## 🗄️ Database Schema

```sql
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    custom_hash TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NULL,
    download_count INTEGER NOT NULL DEFAULT 0
);
```

## 🧹 Cleanup & Maintenance

### Manual Cleanup
Remove expired files immediately:

```bash
npm run cleanup
```

Or with dry-run (preview what would be deleted):
```bash
node server/cleanup.js --dry-run
```

### Daemon Mode
Run cleanup continuously (every hour):

```bash
node server/cleanup.js --daemon
```

### Cron Job
For production, add to crontab:

```bash
# Clean up expired files every hour
0 * * * * cd /path/to/zipp && node server/cleanup.js
```

## ⚙️ Environment Variables

Create a `.env` file for customization:

```env
PORT=3000                    # Server port (default: 3000)
NODE_ENV=production          # Environment mode
```

## 🔒 Security Notes

- File uploads are limited to 100MB by default
- Custom slugs are validated (only letters, numbers, dashes, underscores)
- Files are stored in UUID-named directories
- SQL injection is prevented via parameterized queries
- XSS is prevented via HTML escaping in the frontend

## 🚧 Development

### Run in Development Mode

```bash
npm start
# or
node server/index.js
```

### Database Reset

To reset the database (WARNING: all data will be lost):

```bash
rm db/zipp.db  # On Windows: del db\zipp.db
npm start      # Will recreate with schema
```

## 📜 License

MIT — Free for personal and commercial use.

## 🙏 Credits

Made with ❤️ using Node.js, Express, and SQLite.

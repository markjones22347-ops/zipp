/**
 * Zipp File Hosting - Frontend Application
 */

// Local storage key for saved uploads
const STORAGE_KEY = 'zipp_uploads';

// DOM Elements
const uploadSection = document.getElementById('uploadSection');
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const selectedFile = document.getElementById('selectedFile');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const removeFile = document.getElementById('removeFile');
const uploadForm = document.getElementById('uploadForm');
const expiryOption = document.getElementById('expiryOption');
const customExpiryGroup = document.getElementById('customExpiryGroup');
const customExpiry = document.getElementById('customExpiry');
const uploadBtn = document.getElementById('uploadBtn');

const successSection = document.getElementById('successSection');
const shareLink = document.getElementById('shareLink');
const copyBtn = document.getElementById('copyBtn');
const fileSummary = document.getElementById('fileSummary');
const newUploadBtn = document.getElementById('newUploadBtn');

const recentList = document.getElementById('recentList');
const toast = document.getElementById('toast');
const toastIcon = document.getElementById('toastIcon');
const toastMessage = document.getElementById('toastMessage');

// State
let currentFile = null;

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format expiry for display
 */
function formatExpiry(expiresAt) {
    if (!expiresAt) return 'Never';
    
    const date = new Date(expiresAt);
    const now = new Date();
    const diffMs = date - now;
    
    if (diffMs < 0) return 'Expired';
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffDays > 0) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} left`;
    } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} left`;
    } else {
        return 'Less than an hour';
    }
}

/**
 * Show toast notification
 */
function showToast(message, icon = '✓', duration = 3000) {
    toastIcon.textContent = icon;
    toastMessage.textContent = message;
    toast.classList.add('visible');
    
    setTimeout(() => {
        toast.classList.remove('visible');
    }, duration);
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', '✓');
        return true;
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        
        try {
            document.execCommand('copy');
            showToast('Copied to clipboard!', '✓');
            return true;
        } catch (err) {
            showToast('Failed to copy', '✗');
            return false;
        } finally {
            textArea.remove();
        }
    }
}

/**
 * Handle file selection
 */
function handleFileSelect(file) {
    if (!file) return;
    
    // Check file size (100MB limit)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
        showToast('File too large (max 100MB)', '⚠');
        return;
    }
    
    currentFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    
    // Show selected file, hide upload area
    selectedFile.classList.add('visible');
    uploadArea.style.display = 'none';
    
    // Auto-fill display name if empty
    const displayNameInput = document.getElementById('displayName');
    if (!displayNameInput.value) {
        // Remove extension and replace underscores/dashes with spaces
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        displayNameInput.value = nameWithoutExt.replace(/[_-]/g, ' ').trim();
    }
}

/**
 * Clear selected file
 */
function clearFile() {
    currentFile = null;
    fileInput.value = '';
    selectedFile.classList.remove('visible');
    uploadArea.style.display = 'block';
}

/**
 * Handle drag and drop events
 */
function setupDragAndDrop() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });
    
    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.classList.add('drag-over');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.classList.remove('drag-over');
        }, false);
    });
    
    uploadArea.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });
}

/**
 * Handle expiry option change
 */
function handleExpiryChange() {
    if (expiryOption.value === 'custom') {
        customExpiryGroup.classList.add('visible');
        // Set minimum to current time
        const now = new Date();
        now.setMinutes(now.getMinutes() + 1);
        customExpiry.min = now.toISOString().slice(0, 16);
        customExpiry.value = now.toISOString().slice(0, 16);
    } else {
        customExpiryGroup.classList.remove('visible');
    }
}

/**
 * Handle form submission
 */
async function handleUpload(e) {
    e.preventDefault();
    
    if (!currentFile) {
        showToast('Please select a file first', '⚠');
        return;
    }
    
    const displayName = document.getElementById('displayName').value.trim();
    if (!displayName) {
        showToast('Please enter a display name', '⚠');
        return;
    }
    
    // Show loading state
    uploadBtn.disabled = true;
    uploadBtn.classList.add('loading');
    
    const formData = new FormData();
    formData.append('file', currentFile);
    formData.append('display_name', displayName);
    formData.append('description', document.getElementById('description').value.trim());
    formData.append('expiry_option', expiryOption.value);
    
    if (expiryOption.value === 'custom') {
        formData.append('custom_expiry', customExpiry.value);
    }
    
    const customSlug = document.getElementById('customSlug').value.trim();
    if (customSlug) {
        formData.append('custom_slug', customSlug);
    }
    
    const password = document.getElementById('password').value.trim();
    if (password) {
        formData.append('password', password);
    }
    
    try {
        // Show progress bar
        const progressContainer = document.getElementById('progressContainer');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        progressContainer.classList.remove('hidden');
        
        // Use XMLHttpRequest for progress tracking
        const result = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    progressFill.style.width = percent + '%';
                    progressText.textContent = percent + '%';
                }
            });
            
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        reject(new Error('Invalid response from server'));
                    }
                } else {
                    try {
                        const error = JSON.parse(xhr.responseText);
                        reject(new Error(error.error || `Upload failed (${xhr.status})`));
                    } catch (e) {
                        reject(new Error(`Upload failed (${xhr.status})`));
                    }
                }
            });
            
            xhr.addEventListener('error', () => reject(new Error('Network error')));
            xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
            
            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        });
        
        if (!result.success) {
            throw new Error(result.error || 'Upload failed');
        }
        
        // Hide progress bar
        progressContainer.classList.add('hidden');
        
        // Save to localStorage and show success
        saveUpload(result.file);
        showSuccess(result);
        
    } catch (error) {
        // Hide progress bar on error
        document.getElementById('progressContainer').classList.add('hidden');
        showToast(error.message, 'x', 5000);
        console.error('Upload error:', error);
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.classList.remove('loading');
    }
}

/**
 * Show success UI with file info
 */
function showSuccess(result) {
    const fullUrl = window.location.origin + result.url;
    const infoUrl = fullUrl + '/info';
    shareLink.value = infoUrl;
    
    // Build file summary
    const file = result.file;
    const expiryText = file.expires_at 
        ? new Date(file.expires_at).toLocaleString()
        : 'Never';
    
    fileSummary.innerHTML = `
        <div class="file-summary-item">
            <span class="file-summary-label">Name</span>
            <span class="file-summary-value">${escapeHtml(file.display_name)}</span>
        </div>
        <div class="file-summary-item">
            <span class="file-summary-label">Original File</span>
            <span class="file-summary-value">${escapeHtml(file.original_filename)}</span>
        </div>
        <div class="file-summary-item">
            <span class="file-summary-label">Size</span>
            <span class="file-summary-value">${file.size_formatted}</span>
        </div>
        <div class="file-summary-item">
            <span class="file-summary-label">Expires</span>
            <span class="file-summary-value">${expiryText}</span>
        </div>
        <div class="file-summary-item">
            <span class="file-summary-label">Link</span>
            <span class="file-summary-value">/d/${file.custom_hash}</span>
        </div>
    `;
    
    // Switch sections
    uploadSection.classList.add('hidden');
    successSection.classList.remove('hidden');
    
    // Auto-copy info page URL
    copyToClipboard(infoUrl);
    copyBtn.classList.add('copied');
    copyBtn.querySelector('.copy-text').textContent = 'Copied!';
}

/**
 * Save upload to localStorage
 */
function saveUpload(file) {
    const uploads = getUploads();
    const newUpload = {
        ...file,
        fullUrl: window.location.origin + `/d/${file.custom_hash}`,
        savedAt: new Date().toISOString()
    };
    uploads.unshift(newUpload);
    if (uploads.length > 20) uploads.pop();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uploads));
    renderUploads();
}

/**
 * Get uploads from localStorage
 */
function getUploads() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

/**
 * Clear all saved uploads
 */
function clearUploads() {
    localStorage.removeItem(STORAGE_KEY);
    renderUploads();
}

/**
 * Delete a specific upload from storage
 */
function deleteUpload(hash) {
    const uploads = getUploads().filter(u => u.custom_hash !== hash);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uploads));
    renderUploads();
}

/**
 * Render uploads list
 */
function renderUploads() {
    const uploads = getUploads();
    if (uploads.length === 0) {
        recentList.innerHTML = '<p class="recent-empty">No uploads yet. Upload a file to see it here!</p>';
        return;
    }
    
    recentList.innerHTML = uploads.map(file => {
        const isExpired = file.expires_at && new Date(file.expires_at) < new Date();
        const expiryClass = isExpired ? 'expired' : (file.expires_at ? '' : 'never');
        const expiryText = formatExpiry(file.expires_at);
        const savedDate = new Date(file.savedAt).toLocaleDateString();
        const infoUrl = file.fullUrl + '/info';
        const downloadUrl = file.fullUrl + '?download=1';
        
        return `
            <div class="recent-item">
                <div class="recent-icon">#</div>
                <div class="recent-info">
                    <div class="recent-name">${escapeHtml(file.display_name)}</div>
                    <div class="recent-meta">
                        <span>${file.size_formatted}</span>
                        <span class="recent-expiry ${expiryClass}">${expiryText}</span>
                        <span>dl: ${file.download_count || 0}</span>
                        <span title="Saved ${savedDate}">[${savedDate}]</span>
                    </div>
                </div>
                <div class="recent-actions">
                    <button class="recent-btn" onclick="copyLink('${infoUrl}', this)" title="Copy link">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <a href="${infoUrl}" class="recent-btn" title="View file page" target="_blank">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    </a>
                    <button class="recent-btn" onclick="deleteUpload('${file.custom_hash}')" title="Remove from list">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Copy link handler
 */
function copyLink(url, btn) {
    copyToClipboard(url).then(() => {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        btn.style.color = 'var(--success)';
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.color = '';
        }, 2000);
    });
}

/**
 * Reset to upload form
 */
function resetUpload() {
    // Reset form
    uploadForm.reset();
    clearFile();
    handleExpiryChange();
    
    // Reset button
    copyBtn.classList.remove('copied');
    copyBtn.querySelector('.copy-text').textContent = 'Copy';
    
    // Switch sections
    successSection.classList.add('hidden');
    uploadSection.classList.remove('hidden');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
    
    // Remove file button
    removeFile.addEventListener('click', clearFile);
    
    // Expiry option change
    expiryOption.addEventListener('change', handleExpiryChange);
    
    // Form submission
    uploadForm.addEventListener('submit', handleUpload);
    
    // Copy button
    copyBtn.addEventListener('click', () => {
        copyToClipboard(shareLink.value);
        copyBtn.classList.add('copied');
        copyBtn.querySelector('.copy-text').textContent = 'Copied!';
        
        setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.querySelector('.copy-text').textContent = 'Copy';
        }, 2000);
    });
    
    // New upload button
    newUploadBtn.addEventListener('click', resetUpload);
    
    // Setup drag and drop
    setupDragAndDrop();
    
    // Render saved uploads
    renderUploads();
    
    // Set initial custom expiry min
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    customExpiry.min = now.toISOString().slice(0, 16);
});

// Expose functions for inline handlers
window.copyLink = copyLink;
window.deleteUpload = deleteUpload;

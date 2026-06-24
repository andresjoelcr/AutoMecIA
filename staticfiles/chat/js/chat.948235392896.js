document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const sidebar = document.getElementById('sidebar');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileCloseBtn = document.getElementById('mobileCloseBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const currentChatTitle = document.getElementById('currentChatTitle');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const messagesContainer = document.getElementById('messagesContainer');
    const welcomeScreen = document.getElementById('welcomeScreen');
    const typingIndicator = document.getElementById('typingIndicator');
    const attachmentPreviewWrapper = document.getElementById('attachmentPreviewWrapper');
    const imagePreview = document.getElementById('imagePreview');
    const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const imageInput = document.getElementById('imageInput');
    const attachBtn = document.getElementById('attachBtn');
    const sendBtn = document.getElementById('sendBtn');
    
    // Application State (Memory-only, no localStorage)
    let messages = [];
    let selectedImageBase64 = null; // Store base64 representation of image for instant UI render
    let selectedImageFile = null;   // Store the actual File/Blob object currently attached (Browser or Unity)

    // Initialize marked options (for safe rendering of markdown)
    marked.setOptions({
        breaks: true,
        sanitize: true
    });

    // --- Core Functions ---

    // Initialize a completely new, clean conversation
    function startNewChat() {
        messages = [];
        currentChatTitle.textContent = 'Nueva Conversación';
        clearAttachment();
        renderMessages([]);
        
        // Hide mobile sidebar
        sidebar.classList.remove('active');
        messageInput.focus();
    }

    // Render the messages stream
    function renderMessages(msgs) {
        // Clear all elements
        messagesContainer.innerHTML = '';
        
        if (msgs.length === 0) {
            // Show welcome screen
            messagesContainer.appendChild(welcomeScreen);
            welcomeScreen.style.display = 'flex';
            lucide.createIcons();
            return;
        }
        
        welcomeScreen.style.display = 'none';
        
        msgs.forEach(msg => {
            const row = document.createElement('div');
            row.className = `message-row ${msg.sender}`;
            
            let imageHtml = '';
            if (msg.image) {
                imageHtml = `<img class="message-image" src="${msg.image}" alt="Imagen de análisis">`;
            }
            
            const messageBody = msg.sender === 'bot' 
                ? marked.parse(msg.text) 
                : `<p>${escapeHtml(msg.text).replace(/\n/g, '<br>')}</p>`;
                
            row.innerHTML = `
                <div class="message-wrapper">
                    ${imageHtml}
                    <div class="message-bubble">
                        ${messageBody}
                    </div>
                    <span class="message-time">${msg.time || ''}</span>
                </div>
            `;
            
            messagesContainer.appendChild(row);
        });
        
        scrollToBottom();
        lucide.createIcons();
    }

    // Add a single message to state and view
    function addMessage(sender, text, imageBase64 = null) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const newMsg = {
            sender: sender,
            text: text,
            image: imageBase64,
            time: timeStr
        };
        
        messages.push(newMsg);
        
        // Dynamically update the header title based on user's first prompt
        if (messages.length === 1 && sender === 'user') {
            const cleanTitle = text.trim().substring(0, 32) + (text.length > 32 ? '...' : '');
            currentChatTitle.textContent = cleanTitle || 'Conversación de Diagnóstico';
        }
        
        renderMessages(messages);
    }

    // Scroll chat viewport to the bottom
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // --- Network API Request ---

    // Send data to backend endpoint
    async function sendMessageToBackend(text, imageFile) {
        showTypingIndicator(true);
        
        // OPTIMIZATION: slice only the last 6 messages as context history to minimize input token costs.
        // We do this BEFORE appending the user's latest prompt to keep previous turns history separate.
        // Also, we strip base64 image strings from historical turns to avoid sending megabytes of redundant payloads.
        const historyToSend = messages.slice(0, -1).slice(-6).map(m => ({
            sender: m.sender,
            text: m.text
        }));

        const formData = new FormData();
        formData.append('message', text);
        formData.append('history', JSON.stringify(historyToSend));
        
        if (imageFile) {
            formData.append('image', imageFile);
        }
        
        // Retrieve Django CSRF token
        const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
        
        try {
            const response = await fetch('/api/chat/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            showTypingIndicator(false);
            
            if (data.status === 'success') {
                addMessage('bot', data.response);
            } else {
                addMessage('bot', `**Error:** ${data.response || 'Ocurrió un problema procesando tu mensaje.'}`);
            }
            
        } catch (error) {
            console.error('Error contacting chat API:', error);
            showTypingIndicator(false);
            addMessage('bot', '**Error de Conexión:** No se pudo establecer conexión con el servidor. Por favor, asegúrate de que el servidor Django esté ejecutándose.');
        }
    }

    // Show or hide assistant thinking dots
    function showTypingIndicator(show) {
        if (show) {
            typingIndicator.style.display = 'flex';
            scrollToBottom();
        } else {
            typingIndicator.style.display = 'none';
        }
    }

    // --- Image Handling Helpers ---

    function clearAttachment() {
        imageInput.value = '';
        imagePreview.src = '';
        attachmentPreviewWrapper.style.display = 'none';
        attachBtn.classList.remove('has-file');
        selectedImageBase64 = null;
        selectedImageFile = null; // Clear Unity or Browser file reference
    }

    // Convert file object to Base64 String (for instant rendering in chat bubbles)
    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    }

    // --- Unified Image Processing Logic ---

    // [Unified Function] Processes any image file (from <input type="file"> or converted from Unity Base64)
    async function processImageFile(file) {
        if (!file) return;

        // Validation for image types
        if (!file.type.startsWith('image/')) {
            alert('Por favor selecciona solo archivos de imagen.');
            clearAttachment();
            return;
        }

        // Save reference for later submit
        selectedImageFile = file;

        // Render preview in UI
        const objectUrl = URL.createObjectURL(file);
        imagePreview.src = objectUrl;
        attachmentPreviewWrapper.style.display = 'flex';
        attachBtn.classList.add('has-file');

        // Read base64 to display instantly in client user chat bubbles
        try {
            selectedImageBase64 = await readFileAsBase64(file);
        } catch (err) {
            console.error("Error reading image:", err);
        }
    }

    // [Unity helper] Converts a base64 string to a standard HTML File object
    function base64ToFile(base64, filename, mimeType) {
        let rawBase64 = base64;
        let actualMime = mimeType;
        
        // Handle potential data URL prefixes (e.g. data:image/png;base64,...)
        if (base64.startsWith('data:')) {
            const parts = base64.split(',');
            rawBase64 = parts[1];
            actualMime = parts[0].split(';')[0].split(':')[1];
        }
        
        // Decode base64 bytes
        const byteString = atob(rawBase64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        
        return new File([ab], filename, { type: actualMime });
    }

    // --- Unity Integration Hook ---
    // Registers a global hook for Unity Gree WebView callback sending selected gallery image
    window.receiveImage = function(base64Data) {
        try {
            const filename = `unity_image_${Date.now()}.jpg`;
            const defaultMime = 'image/jpeg';
            
            // Convert to standard File
            const file = base64ToFile(base64Data, filename, defaultMime);
            
            // Send to the unified processing function
            processImageFile(file);
        } catch (error) {
            console.error("Error processing base64 image from Unity:", error);
            alert("Error al recibir la imagen de la galería de la aplicación.");
        }
    };

    // --- Helper Utilities ---

    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    // Auto-grow message input textarea
    function adjustTextareaHeight() {
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    }

    // --- Event Listeners ---

    // Toggle Mobile Sidebar Menu
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('active');
    });

    mobileCloseBtn.addEventListener('click', () => {
        sidebar.classList.remove('active');
    });

    // Create a new chat session click
    newChatBtn.addEventListener('click', () => {
        startNewChat();
    });

    // Clear chat click
    clearChatBtn.addEventListener('click', () => {
        if (confirm('¿Estás seguro de que deseas vaciar los mensajes de esta conversación?')) {
            startNewChat();
        }
    });

    // Info Modal toggles
    infoBtn.addEventListener('click', () => {
        infoModal.classList.add('open');
    });

    closeModalBtn.addEventListener('click', () => {
        infoModal.classList.remove('open');
    });

    infoModal.addEventListener('click', (e) => {
        if (e.target === infoModal) {
            infoModal.classList.remove('open');
        }
    });

    // Click on suggested prompt card
    messagesContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.suggested-prompt-card');
        if (card) {
            const prompt = card.getAttribute('data-prompt');
            messageInput.value = prompt;
            adjustTextareaHeight();
            messageInput.focus();
        }
    });

    // Textarea typing events
    messageInput.addEventListener('input', adjustTextareaHeight);
    messageInput.addEventListener('keydown', (e) => {
        // Submit on Enter (unless shift is pressed)
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit'));
        }
    });

    // Trigger File Input Dialog
    attachBtn.addEventListener('click', () => {
        imageInput.click();
    });

    // File selection handling (Browser Standard Environment)
    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            processImageFile(file);
        }
    });

    // Remove selected image
    removeAttachmentBtn.addEventListener('click', () => {
        clearAttachment();
    });

    // Chat form submit (Unified browser and Unity submission)
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const messageText = messageInput.value.trim();
        // Use the unified selectedImageFile variable which can come from standard input OR Unity WebView
        const file = selectedImageFile;
        
        if (!messageText && !file) return;
        
        // Disable send button while processing
        sendBtn.disabled = true;
        
        // Save attachment and message to client local state
        const imageToSave = selectedImageBase64;
        addMessage('user', messageText, imageToSave);
        
        // Reset input fields in the UI
        messageInput.value = '';
        adjustTextareaHeight();
        clearAttachment();
        messageInput.focus();
        sendBtn.disabled = false;
        
        // Request backend response asynchronously
        await sendMessageToBackend(messageText, file);
    });

    // Bootstrapping: Start fresh chat session
    startNewChat();
});

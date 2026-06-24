import json
import base64
import requests
from django.shortcuts import render
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import ensure_csrf_cookie
from django.conf import settings

@ensure_csrf_cookie
def chat_home(request):
    """
    Renders the main chat application homepage.
    """
    return render(request, 'chat/index.html')

@require_POST
def chat_api(request):
    """
    Handles conversational API requests using OpenAI's gpt-4o-mini.
    Includes rules for credit optimization:
    1. detail: "low" for images (only 85 tokens per image).
    2. Context history cleaning: Strips image data from past history turns.
    3. max_tokens limit of 600.
    4. Strict mechanical focus system prompt.
    """
    # Retrieve configuration API key
    api_key = getattr(settings, 'OPENAI_API_KEY', None)
    if not api_key:
        return JsonResponse({
            'status': 'error',
            'response': 'La API Key de OpenAI no está configurada en el servidor.'
        }, status=500)

    message_text = ""
    has_image = False
    image_data = None
    image_file = None
    history = []

    # Check if request content type is JSON
    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            message_text = data.get('message', '')
            image_data = data.get('image', None)  # Base64 image
            if image_data:
                has_image = True
            history = data.get('history', [])
        except json.JSONDecodeError:
            return JsonResponse({'status': 'error', 'response': 'Invalid JSON'}, status=400)
    else:
        # Standard multipart/form-data
        message_text = request.POST.get('message', '')
        if 'image' in request.FILES:
            image_file = request.FILES['image']
            has_image = True
        
        history_json = request.POST.get('history', '[]')
        try:
            history = json.loads(history_json)
        except json.JSONDecodeError:
            history = []

    # Strict System Instruction: Mechanical focus constraint
    system_prompt = (
        "Eres un asistente de mecánica automotriz altamente especializado para ChatMecánica. "
        "Tu único propósito es responder a consultas relacionadas con mecánica automotriz, ingeniería, diagnósticos y reparaciones. "
        "Si la consulta del usuario NO tiene relación directa con mecánica o ingeniería automotriz, "
        "debes declinar responder de manera cortés y amigable indicando que estás diseñado exclusivamente para ayudar en temas de mecánica. "
        "Sé preciso y directo para optimizar el largo de las respuestas."
    )

    # Initialize OpenAI messages payload
    openai_messages = [{"role": "system", "content": system_prompt}]

    # OPTIMIZATION: Append conversation history but strip base64 image data from previous turns to save input tokens.
    # We only send the message text of historical turns.
    for msg in history:
        role = 'user' if msg.get('sender') == 'user' else 'assistant'
        text = msg.get('text', '')
        if text:
            openai_messages.append({"role": role, "content": text})

    # Prepare content for current turn
    if has_image:
        user_content = []
        if message_text:
            user_content.append({"type": "text", "text": message_text})
        
        # Prepare base64 representation of current image
        base64_image = ""
        mime_type = "image/jpeg"
        
        if image_file:
            # Read from uploaded file
            image_bytes = image_file.read()
            mime_type = image_file.content_type or "image/jpeg"
            base64_image = base64.b64encode(image_bytes).decode('utf-8')
        elif image_data:
            # Read from base64 string
            base64_image = image_data
            if "," in base64_image:
                mime_type = base64_image.split(";")[0].split(":")[1]
                base64_image = base64_image.split(",")[1]

        # Add image message
        user_content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{base64_image}",
                "detail": "low"  # OPTIMIZATION: Low detail mode consumes only 85 tokens
            }
        })
        openai_messages.append({"role": "user", "content": user_content})
    else:
        openai_messages.append({"role": "user", "content": message_text})

    # Call OpenAI Chat Completions endpoint
    api_url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # We use gpt-4o-mini: low cost, fast response, supports vision/image analysis.
    payload = {
        "model": "gpt-4o-mini",
        "messages": openai_messages,
        "max_tokens": 600,       # OPTIMIZATION: limit max response length
        "temperature": 0.3       # Lower temperature to keep focus on factual mechanics
    }

    try:
        response = requests.post(api_url, json=payload, headers=headers, timeout=40)
        response.raise_for_status()
        result = response.json()
        reply_text = result['choices'][0]['message']['content']
        
        return JsonResponse({
            'status': 'success',
            'response': reply_text
        })
    except requests.exceptions.RequestException as req_err:
        # Network/HTTP exceptions
        error_msg = f"Error en la petición a OpenAI API: {str(req_err)}"
        if response is not None:
            try:
                err_detail = response.json()
                error_msg += f" - Detalle: {err_detail.get('error', {}).get('message', '')}"
            except Exception:
                pass
        return JsonResponse({
            'status': 'error',
            'response': f"Lo siento, ocurrió un problema de conexión con el motor de IA. ({error_msg})"
        }, status=502)
    except Exception as e:
        return JsonResponse({
            'status': 'error',
            'response': f"Ocurrió un error inesperado al procesar la respuesta: {str(e)}"
        }, status=500)

def ping(request):
    """
    Simple health check view.
    """
    return HttpResponse("OK", content_type="text/plain")

from django.test import TestCase, Client
from django.urls import reverse
from unittest.mock import patch, MagicMock
import json

class ChatViewsTestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.home_url = reverse('chat:chat_home')
        self.api_url = reverse('chat:chat_api')

    def test_chat_home_view(self):
        """Test that the home page renders correctly and uses index.html template"""
        response = self.client.get(self.home_url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'chat/index.html')

    @patch('requests.post')
    def test_chat_api_post_text_success(self, mock_post):
        """Test that posting text to the API calls OpenAI and returns success JSON"""
        # Configure the mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'choices': [{
                'message': {
                    'content': 'Este es un mensaje de prueba de mecánica.'
                }
            }]
        }
        mock_post.return_value = mock_response

        payload = {'message': '¿Cómo funciona un motor de cuatro tiempos?'}
        response = self.client.post(self.api_url, data=payload)
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['content-type'], 'application/json')
        
        data = json.loads(response.content.decode('utf-8'))
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['response'], 'Este es un mensaje de prueba de mecánica.')
        
        # Verify that requests.post was called with correct model and max_tokens parameters
        self.assertTrue(mock_post.called)
        called_args, called_kwargs = mock_post.call_args
        self.assertEqual(called_args[0], "https://api.openai.com/v1/chat/completions")
        
        payload_sent = called_kwargs['json']
        self.assertEqual(payload_sent['model'], 'gpt-4o-mini')
        self.assertEqual(payload_sent['max_tokens'], 600)
        
        # Verify the system prompt is present
        self.assertEqual(payload_sent['messages'][0]['role'], 'system')
        self.assertIn('asistente de mecánica', payload_sent['messages'][0]['content'])

    @patch('requests.post')
    def test_chat_api_post_json_success(self, mock_post):
        """Test that posting JSON payload to the API works similarly and parses history"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'choices': [{
                'message': {
                    'content': 'La presión ideal depende del fabricante, usualmente 32 psi.'
                }
            }]
        }
        mock_post.return_value = mock_response

        payload = {
            'message': '¿Cuál es la presión de las llantas?',
            'history': [
                {'sender': 'user', 'text': 'Hola'},
                {'sender': 'bot', 'text': 'Hola, ¿en qué te ayudo?'}
            ]
        }
        response = self.client.post(
            self.api_url, 
            data=json.dumps(payload), 
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content.decode('utf-8'))
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['response'], 'La presión ideal depende del fabricante, usualmente 32 psi.')

        # Verify history was parsed and sent (excluding images)
        called_kwargs = mock_post.call_args[1]
        messages_sent = called_kwargs['json']['messages']
        # system message + 2 history messages + 1 current message = 4 messages total
        self.assertEqual(len(messages_sent), 4)
        self.assertEqual(messages_sent[1]['role'], 'user')
        self.assertEqual(messages_sent[1]['content'], 'Hola')
        self.assertEqual(messages_sent[2]['role'], 'assistant')
        self.assertEqual(messages_sent[2]['content'], 'Hola, ¿en qué te ayudo?')

    def test_chat_api_only_allows_post(self):
        """Test that GET requests to the API endpoint are blocked (405 Method Not Allowed)"""
        response = self.client.get(self.api_url)
        self.assertEqual(response.status_code, 405)

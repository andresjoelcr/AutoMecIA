from django.urls import path
from . import views

app_name = 'chat'

urlpatterns = [
    path('', views.chat_home, name='chat_home'),
    path('api/chat/', views.chat_api, name='chat_api'),
    path('ping/', views.ping, name='ping'),
]

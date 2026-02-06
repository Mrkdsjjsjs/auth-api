# CLAUDE.md

## ВАЖНО: Инструкция по деплою

### Сервер
- **IP**: 85.239.52.213
- **User**: root
- **Password**: xt^CQu+CW++G5W
- **Путь**: /opt/messenger
- **Домен**: https://gayauth228gay.duckdns.org

### Как деплоить (используй sshpass):
```bash
# Полный деплой (frontend + backend)
sshpass -p 'xt^CQu+CW++G5W' ssh -o StrictHostKeyChecking=no root@85.239.52.213 "cd /opt/messenger && git pull origin claude-scaffold && docker-compose build && docker-compose up -d"

# Только frontend
sshpass -p 'xt^CQu+CW++G5W' ssh -o StrictHostKeyChecking=no root@85.239.52.213 "cd /opt/messenger && git pull origin claude-scaffold && docker-compose build frontend && docker-compose up -d frontend"

# Только backend
sshpass -p 'xt^CQu+CW++G5W' ssh -o StrictHostKeyChecking=no root@85.239.52.213 "cd /opt/messenger && git pull origin claude-scaffold && docker-compose build backend && docker-compose up -d backend"
```

### Проверить логи:
```bash
# Backend логи
sshpass -p 'xt^CQu+CW++G5W' ssh root@85.239.52.213 "cd /opt/messenger && docker-compose logs --tail=50 backend"

# Frontend логи
sshpass -p 'xt^CQu+CW++G5W' ssh root@85.239.52.213 "cd /opt/messenger && docker-compose logs --tail=50 frontend"

# TURN server логи
sshpass -p 'xt^CQu+CW++G5W' ssh root@85.239.52.213 "docker logs messenger-coturn --tail=50"
```

### Порядок работы:
1. Вносишь изменения локально
2. `git add -A && git commit -m "описание" && git push origin claude-scaffold`
3. Деплоишь на сервер командой выше
4. Если ошибка TypeScript - исправь и повтори

---

## Проект

Это SaaS мессенджер с end-to-end шифрованием (Shadowlum).

### Стек:
- **Backend**: Python FastAPI, PostgreSQL, Redis, WebSocket
- **Frontend**: React + TypeScript + Vite + Zustand + Tailwind

### Ветка: claude-scaffold

### Что уже сделано:
- Авторизация/регистрация
- Чаты 1-на-1
- E2E шифрование (X25519 + AES-GCM)
- Отправка зашифрованных файлов
- WebSocket для реального времени
- Профиль пользователя
- Уведомления со звуком
- **Аудио звонки WebRTC с TURN сервером**
- **Демонстрация экрана (screen sharing)**

### Ключевые файлы:
- `frontend/src/pages/ChatPage.tsx` — основная страница чата
- `frontend/src/store/chatStore.ts` — Zustand store с WebSocket
- `frontend/src/store/callStore.ts` — Zustand store для звонков
- `frontend/src/services/webrtc.ts` — WebRTC сервис
- `frontend/src/components/CallModal.tsx` — UI звонка
- `app/routes/websocket.py` — WebSocket эндпоинт
- `app/services/call_service.py` — логика звонков на бэкенде

---

## Архитектура

### Backend (`/app`)
- `main.py` - FastAPI app
- `routes/` - API endpoints (auth, users, chats, messages, websocket, calls)
- `models/` - SQLModel database models
- `services/` - Business logic

### Frontend (`/frontend/src`)
- `pages/` - Route pages
- `components/` - UI components
- `services/` - API, WebSocket, WebRTC, crypto
- `store/` - Zustand stores

### WebRTC Flow:
1. Caller: `initiateCall()` → sends `call_initiate`
2. Callee: receives `call_incoming` → shows notification
3. Callee: `acceptCall()` → creates PeerConnection → sends `call_accept`
4. Caller: receives `call_accepted` → creates offer → sends `call_offer`
5. Callee: receives `call_offer` → creates answer → sends `call_answer`
6. Both: exchange ICE candidates via `call_ice_candidate`
7. Connection established!

### Screen Share:
1. User clicks Share → `getDisplayMedia()`
2. Adds video track to PeerConnection
3. Emits `needsrenegotiation` → creates new offer
4. Remote receives offer, creates answer
5. Video track appears on remote side

# Fonoaudioplay

Painel web responsivo para o acompanhamento fonoaudiológico entre sessões. O projeto reúne um frontend React/TypeScript, uma API Fastify, persistência SQLite, Firebase Authentication e transcrição opcional de áudio pelo Whisper.

## Requisitos

- Node.js 22 ou superior
- Um projeto Firebase com o provedor de e-mail/senha habilitado para o painel
- Credenciais do Firebase Admin para a API
- Chave OpenAI somente se a transcrição de gravações for utilizada

## Iniciar localmente

```powershell
npm install
Copy-Item .env.example .env
npm run dev:api
```

Em outro terminal PowerShell, no mesmo diretório:

```powershell
npm run dev
```

O painel abre em `http://localhost:5173` e a API em `http://localhost:3001`. Sem configuração Firebase no frontend, o painel abre em modo demonstração com dados fictícios de sessão, sem enviar ou persistir dados pessoais.

## Configuração

1. Preencha `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` e `VITE_FIREBASE_APP_ID` no `.env` com a configuração do app Web Firebase.
2. Configure `GOOGLE_APPLICATION_CREDENTIALS` com o caminho local para uma credencial de conta de serviço do Firebase Admin. Alternativamente, use `FIREBASE_SERVICE_ACCOUNT_JSON` no ambiente do servidor. Nunca exponha essas credenciais no frontend nem as versione.
3. Cadastre as contas pelo Firebase Authentication. Defina a claim `role` de cada conta pelo Firebase Admin:

   ```powershell
   npm run set:role -- <firebase-uid> therapist
   npm run set:role -- <firebase-uid> guardian
   ```

   O comando mantém as outras custom claims existentes. O usuário precisa entrar novamente para receber a claim atualizada. Contas de responsáveis só acessam pacientes associados à UID Firebase informada pelo profissional no cadastro.

4. Se necessário, defina `OPENAI_API_KEY` para habilitar a transcrição em português. Sem a chave, o restante da aplicação funciona e a API informa que o serviço de transcrição está indisponível.

5. `DATABASE_PATH` e `RECORDINGS_DIR` definem onde os dados SQLite e os áudios privados são armazenados; o padrão é a pasta local `data/`.

Após alterar variáveis `VITE_FIREBASE_*`, reinicie o servidor Vite. Para uma implantação, configure `WEB_ORIGIN`, HTTPS, secrets no provedor de hospedagem e armazenamento privado persistente para a base e os áudios.

## Funcionalidades

- Cadastro de pacientes e associação opcional a uma conta de responsável.
- Seleção da trilha semanal de fonemas (R, S, L e F).
- Resumo de exercícios, aproveitamento, atividade recente e relatório por paciente.
- Upload privado e reprodução autenticada de gravações WAV, MP3, M4A e WebM (até 12 MB).
- Transcrição opcional sob demanda pelo Whisper; o texto é retornado à sessão e não é gravado no banco.
- Exclusão do paciente pelo profissional, removendo também seus dados de progresso, vínculos e arquivos de áudio.
- Proteção de rotas pela verificação de tokens Firebase no servidor e autorização por proprietário/conta vinculada.

## Privacidade e LGPD

Dados de crianças e gravações de voz requerem proteção reforçada. Antes de uso real, a clínica deve obter e registrar as autorizações e bases legais apropriadas, limitar o acesso às contas necessárias, definir prazos de retenção e atender solicitações dos titulares e responsáveis. A demonstração utiliza somente registros fictícios.

O endpoint Whisper envia o áudio selecionado para processamento pela OpenAI; use-o apenas quando houver autorização e depois de avaliar as condições aplicáveis ao serviço. Para operação em produção, revise também contratos com fornecedores, região e retenção de dados, política de backups, controles de acesso, logs, resposta a incidentes e descarte seguro. Este software não substitui uma avaliação jurídica ou uma auditoria de conformidade.

## Verificação

```powershell
npm run typecheck
npm run build
```

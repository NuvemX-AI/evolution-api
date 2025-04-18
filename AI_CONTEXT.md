# Contexto do Projeto NuvemX

NuvemX é um SaaS completo de gerenciamento de instâncias de WhatsApp e integrações, composto por duas camadas principais:

---

## Backend

- **Linguagem & Frameworks:** Node.js, TypeScript, Express
- **ORM & Banco de Dados:** Prisma ORM com PostgreSQL
- **Hot‑reload & Build:** `ts-node-dev` para desenvolvimento e `tsup` para build de produção
- **Estrutura de Códigos:**
  - `src/api/` → controladores, rotas e DTOs (endpoints REST para instâncias, mensagens, grupos, etiquetas, configurações, templates, integrações)
  - `src/validate/` → esquemas Zod para validação de payloads
  - `src/common/`, `src/utils/`, `src/exceptions/` → utilitários, traduções, tratamento de erros personalizados
  - `src/integrations/` → integrações externas:
    - **Chatbot:** Chatwoot, Typebot, Flowise, OpenAI, Dify, EvolutionBot
    - **Channel:** WhatsApp (Baileys), Meta, Evolution Channel
    - **Storage:** Amazon S3 (controllers e serviços em `integrations/storage/s3`)
  - `src/cache/` → mecanismo de cache em memória ou Redis (`CacheEngine`)
  - `src/config/` → carregamento de variáveis via `dotenv` (.env)
- **Arquivos de Configuração:**
  - `.env` (.env.example) com variáveis como `SERVER_URL`, `CORS_ORIGIN`, `DATABASE_CONNECTION_URI`, `AUTHENTICATION_API_KEY`
  - `prisma/schema.prisma` e migrations em `prisma/`
- **Scripts Principais (package.json):**
  - `pnpm run start:dev` → inicializa o servidor com hot‑reload em `src/main.ts`
  - `pnpm run db:generate` → gera o Prisma Client
  - `pnpm run build` → compila TypeScript e empacota com `tsup`
  - `pnpm run start:prod` → executa o build em produção

---

## Frontend

- **Framework & Ferramentas:** React, Vite, TypeScript, Tailwind CSS
- **UI Components:** Radix UI e shadcn, `lovable-tagger` custom
- **Gerenciamento de Dados:** TanStack React Query (React Query)
- **Roteamento:** react-router-dom
- **Estrutura de Pastas (frontend/):**
  - `frontend/src/pages/` → páginas principais: Login, Signup, Dashboard, Settings, Subscription, WhatsappConnector, AIPrompt, ShopifyIntegration, Overview, Profile, Chatbot, WhatsappIntegration, Integrations, NotFound, ShopifyCallback
  - `frontend/src/hooks/` → hooks customizados (ex.: `use-toast`)
  - `frontend/src/components/` e `frontend/src/lib/` → componentes reutilizáveis e utilitários
- **Scripts Principais (frontend/package.json):**
  - `pnpm run dev` → inicia o Vite dev server na porta 3000
  - `pnpm run build` → gera build de produção
  - `pnpm run preview` → serve o build localmente

---

## URLs e Comandos de Desenvolvimento

- **Backend**: http://localhost:8080  
  - `pnpm run start:dev`, `pnpm run db:generate`, `pnpm run build`
- **Frontend**: http://localhost:3000  
  - `pnpm run dev`, `pnpm run build`, `pnpm run preview`

---

## Uso no Trae

- **Terminais Integrados:**
  - **Terminal 1:** `pnpm run start:dev` (API)
  - **Terminal 2:** `pnpm run dev` (front)
- **Preview Pane:** selecione a URL 8080 ou 3000 para visualizar em tempo real
- **Inline AI Chat (⌘I):** refatorações e correções diretas no código
- **Side AI Chat:** geração de novos arquivos, endpoints, componentes ou testes
- **Builder Mode:** scaffold de rotas, controllers, serviços ou páginas front-end a partir de prompts de alto nível

Use este contexto para orientar todas as interações de IA no Trae, garantindo sugestões alinhadas à arquitetura e convenções do NuvemX.


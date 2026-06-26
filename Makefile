.PHONY: dev dev-backend dev-frontend

dev-backend:
	@echo "  Starting backend → http://localhost:8000"
	@cd backend && npx tsx src/index.ts

dev-frontend:
	@echo "  Starting frontend → http://localhost:5173"
	@npx vite

dev:
	@echo "  Starting Taskit..."
	@trap 'kill 0' EXIT; \
		cd backend && npx tsx src/index.ts & \
		npx vite; \
		wait

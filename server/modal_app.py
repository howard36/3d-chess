import modal

image = modal.Image.debian_slim().pip_install("fastapi[standard]")

app = modal.App("3d-chess-backend")

@app.function(image=image)
@modal.asgi_app()
def serve() -> "fastapi.FastAPI":
    import fastapi
    web_app = fastapi.FastAPI()

    @web_app.get("/health")
    async def health_check():
        return {"status": "healthy"}

    return web_app 
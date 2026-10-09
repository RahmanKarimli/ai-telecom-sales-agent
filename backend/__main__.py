import uvicorn

from backend.config import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run("backend.main:app", host=settings.host, port=settings.port, workers=1)


if __name__ == "__main__":
    main()

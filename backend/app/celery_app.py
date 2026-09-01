from celery import Celery

from app.settings import Settings

settings = Settings.from_env()
celery_app = Celery("publish_review", broker=settings.broker_url, backend=settings.result_backend, include=["app.tasks"])
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"], task_track_started=True, result_expires=86400)

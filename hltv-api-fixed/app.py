import os

from flask import Flask, jsonify
from flasgger import Swagger


def read_runtime_options():
    raw_port = os.getenv("HLTV_UPSTREAM_PORT", "18020")

    try:
        port = int(raw_port)
    except ValueError:
        port = 18020

    return {
        "host": os.getenv("HLTV_UPSTREAM_HOST", "127.0.0.1"),
        "port": port,
        "debug": os.getenv("HLTV_UPSTREAM_DEBUG", "").lower() in {"1", "true", "yes", "on"},
    }


def create_app():
    app = Flask(__name__)
    
    app.json.sort_keys = False # type: ignore

    Swagger(app)

    raw_health_path = os.getenv("HLTV_UPSTREAM_HEALTH_PATH", "/healthz")
    health_path = raw_health_path if raw_health_path.startswith("/") else f"/{raw_health_path}"

    @app.get(health_path)
    def healthz():
        payload = {"status": "ok"}
        instance_token = os.getenv("HLTV_UPSTREAM_INSTANCE_TOKEN", "").strip()

        if instance_token:
            payload["instance_token"] = instance_token

        return jsonify(payload)

    from routes.teams import teams_bp
    from routes.players import players_bp
    from routes.matches import matches_bp
    from routes.news import news_bp
    from routes.results import results_bp

    app.register_blueprint(teams_bp)
    app.register_blueprint(players_bp)
    app.register_blueprint(matches_bp)
    app.register_blueprint(news_bp)
    app.register_blueprint(results_bp)

    return app

flask_app = create_app()


def run_app(app_instance):
    runtime = read_runtime_options()
    app_instance.run(
        host=runtime["host"],
        port=runtime["port"],
        debug=runtime["debug"],
    )

if __name__ == "__main__":
    run_app(flask_app)

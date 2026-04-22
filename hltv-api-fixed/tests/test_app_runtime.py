import app as app_module
from unittest.mock import Mock


def test_read_runtime_options_defaults(monkeypatch):
    monkeypatch.delenv("HLTV_UPSTREAM_HOST", raising=False)
    monkeypatch.delenv("HLTV_UPSTREAM_PORT", raising=False)
    monkeypatch.delenv("HLTV_UPSTREAM_DEBUG", raising=False)

    assert app_module.read_runtime_options() == {
        "host": "127.0.0.1",
        "port": 18020,
        "debug": False,
    }


def test_read_runtime_options_from_env(monkeypatch):
    monkeypatch.setenv("HLTV_UPSTREAM_HOST", "0.0.0.0")
    monkeypatch.setenv("HLTV_UPSTREAM_PORT", "19001")
    monkeypatch.setenv("HLTV_UPSTREAM_DEBUG", "true")

    assert app_module.read_runtime_options() == {
        "host": "0.0.0.0",
        "port": 19001,
        "debug": True,
    }


def test_run_app_uses_runtime_options(monkeypatch):
    monkeypatch.setenv("HLTV_UPSTREAM_HOST", "0.0.0.0")
    monkeypatch.setenv("HLTV_UPSTREAM_PORT", "19001")
    monkeypatch.setenv("HLTV_UPSTREAM_DEBUG", "true")

    fake_app = Mock()

    app_module.run_app(fake_app)

    fake_app.run.assert_called_once_with(host="0.0.0.0", port=19001, debug=True)

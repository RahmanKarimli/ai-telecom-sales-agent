"""Small additive SQLite upgrades preserving existing demo data."""

from sqlalchemy import Engine, inspect, text


def upgrade_database(engine: Engine) -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("call_turns")}
    with engine.begin() as connection:
        if "response_json" not in columns:
            connection.execute(text("ALTER TABLE call_turns ADD COLUMN response_json JSON"))
        if "input_audio_sha256" not in columns:
            connection.execute(
                text("ALTER TABLE call_turns ADD COLUMN input_audio_sha256 VARCHAR(64)")
            )

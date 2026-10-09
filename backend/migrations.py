"""Small additive SQLite upgrades preserving existing demo data."""

from sqlalchemy import Engine, inspect, text


def upgrade_database(engine: Engine) -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("call_turns")}
    result_columns = {column["name"] for column in inspect(engine).get_columns("call_results")}
    with engine.begin() as connection:
        if "response_json" not in columns:
            connection.execute(text("ALTER TABLE call_turns ADD COLUMN response_json JSON"))
        if "input_audio_sha256" not in columns:
            connection.execute(
                text("ALTER TABLE call_turns ADD COLUMN input_audio_sha256 VARCHAR(64)")
            )
        if "package_approved_at" not in result_columns:
            connection.execute(
                text("ALTER TABLE call_results ADD COLUMN package_approved_at DATETIME")
            )
        if "package_approved_by" not in result_columns:
            connection.execute(
                text("ALTER TABLE call_results ADD COLUMN package_approved_by VARCHAR(100)")
            )

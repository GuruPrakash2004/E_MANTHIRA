"""
Central settings. Everything the app needs comes from environment variables
(loaded from .env in dev). Nowhere else in the codebase should call os.environ
or read a config file directly — see CLAUDE.md rule 7.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    api_prefix: str = "/api/v1"
    frontend_origins: str = "http://localhost:5173"

    # Database. db_engine picks BOTH the dialect and which schema is in play:
    #   pymssql / pyodbc -> legacy SQL Server, UNCHANGED schema (CLAUDE.md rule 1)
    #   mysql            -> fresh sample schema (backend/sql/mysql_schema.sql),
    #                       for local dev/demo without a SQL Server instance
    db_engine: str = "pymssql"  # "pymssql" | "pyodbc" | "mysql"
    db_driver_odbc: str = "ODBC Driver 18 for SQL Server"
    db_server: str = "127.0.0.1"
    db_port: int = 14333
    db_name: str = "vTmplSLV"
    db_user: str = "sa"
    db_password: str = ""
    db_trust_cert: str = "yes"
    audit_db_name: str = "vTmplSLVAuditLog"

    @property
    def is_mysql(self) -> bool:
        return self.db_engine == "mysql"

    # Auth
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_minutes: int = 30
    jwt_refresh_days: int = 7
    legacy_crypto_key: str = "svt$$12@#"

    # Paths
    rpt_path: str = "../../vTempleSLV/Rpts/"
    attachments_path: str = "../../vTempleSLV/Rpts/TrnDocFiles/"

    # Printing (Crystal Reports service — the only supported print engine, see CLAUDE.md §7)
    crystal_service_url: str = "http://localhost:8100"
    crystal_service_timeout_seconds: int = 20

    # Messaging
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    sms_url: str = ""
    sms_sender: str = ""

    @property
    def frontend_origin_list(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def _pyodbc_url(self) -> str:
        driver = self.db_driver_odbc.replace(" ", "+")
        return (
            f"mssql+pyodbc://{self.db_user}:{self.db_password}@"
            f"{self.db_server}:{self.db_port}/{self.db_name}"
            f"?driver={driver}&TrustServerCertificate={self.db_trust_cert}"
        )

    @property
    def _pymssql_url(self) -> str:
        # Pure Python, no ODBC driver install required — but its bundled
        # FreeTDS can't always complete the TLS/login handshake against a
        # server that enforces encryption (confirmed against a real client
        # server: pyodbc reached login-failed, pymssql couldn't handshake
        # at all). Kept only as the automatic fallback, see
        # sqlalchemy_url_candidates below.
        return f"mssql+pymssql://{self.db_user}:{self.db_password}@{self.db_server}:{self.db_port}/{self.db_name}"

    @property
    def sqlalchemy_url(self) -> str:
        """The single URL for `db_engine` as configured — used when a
        caller wants one specific dialect (e.g. mysql dev mode). For the
        real SQL Server target, prefer `sqlalchemy_url_candidates` so
        pyodbc is tried first with an automatic pymssql fallback."""
        if self.db_engine == "mysql":
            return f"mysql+pymysql://{self.db_user}:{self.db_password}@{self.db_server}:{self.db_port}/{self.db_name}?charset=utf8mb4"
        if self.db_engine == "pyodbc":
            return self._pyodbc_url
        return self._pymssql_url

    @property
    def sqlalchemy_url_candidates(self) -> list[tuple[str, str]]:
        """`[(driver_name, url), ...]` in the order to try connecting.
        SQL Server targets always try pyodbc first (needs the ODBC Driver
        18 installed — true of every real counter PC, CLAUDE.md §3) and
        fall back to pymssql automatically if that fails (missing driver,
        handshake failure, etc.) — so the app keeps working even where
        pyodbc isn't set up, without the user having to pick a driver."""
        if self.db_engine == "mysql":
            return [("mysql", self.sqlalchemy_url)]
        return [("pyodbc", self._pyodbc_url), ("pymssql", self._pymssql_url)]


@lru_cache
def get_settings() -> Settings:
    base = Settings()
    # Layer any runtime DB-settings-panel override on top of .env — see
    # app/core/runtime_db_settings.py for why this exists and the CLAUDE.md
    # rule 7 exception it represents. No override file -> unchanged behavior.
    from app.core.runtime_db_settings import load_override

    override = load_override()
    return base.model_copy(update=override) if override else base

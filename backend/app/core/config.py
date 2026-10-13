"""
Central settings. Everything the app needs comes from environment variables
(loaded from .env in dev). Nowhere else in the codebase should call os.environ
or read a config file directly — see CLAUDE.md rule 7.
"""
from functools import lru_cache
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    api_prefix: str = "/api/v1"
    frontend_origins: str = "http://localhost:5173"

    # Database. db_engine picks BOTH the dialect and which schema is in play:
    #   pymssql / pyodbc -> legacy SQL Server, UNCHANGED schema (CLAUDE.md rule 1)
    #   mysql            -> fresh sample schema (backend/sql/mysql_schema.sql),
    #                       for local dev/demo without a SQL Server instance
    db_engine: str = "pyodbc"  # "pyodbc" | "pymssql" | "mysql" (SQL Server always tries pyodbc then pymssql)
    # Nothing here is a real target: server/port/name/user/password come from
    # .env or the Database Settings panel. Empty driver = auto-detect the best
    # installed SQL Server ODBC driver. server may be "host", "host\instance"
    # (named instance, port then ignored/optional) or an IP; port may be blank.
    db_driver_odbc: str = ""
    db_server: str = ""
    db_port: int | None = None
    db_name: str = ""
    db_user: str = ""
    db_password: str = ""
    db_trust_cert: str = "yes"
    audit_db_name: str = "vTmplSLVAuditLog"

    @field_validator("db_port", mode="before")
    @classmethod
    def _blank_port(cls, v):
        return None if v in ("", None) else v

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
    # Folder holding the original Crystal .rpt files. RPT_FOLDER wins; RPT_PATH is the older name for the same thing.
    rpt_folder: str = ""
    attachments_path: str = "../../vTempleSLV/Rpts/TrnDocFiles/"

    # Printing (Crystal Reports service — the only supported print engine, see CLAUDE.md §7)
    crystal_service_url: str = "http://localhost:8100"
    crystal_service_timeout_seconds: int = 20
    # Print bridge (see app/print/rpt_bridge.py). RPT_BRIDGE_URL falls back to CRYSTAL_SERVICE_URL; the key is sent in the
    # X-Rpt-Bridge-Key header and must match the bridge's own key. Secrets stay in .env.
    rpt_bridge_url: str = ""
    rpt_bridge_key: str = ""
    rpt_bridge_connect_timeout_seconds: int = 5
    rpt_bridge_render_timeout_seconds: int = 60

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

    def _odbc_driver(self) -> str | None:
        """Configured driver if installed, else the newest installed SQL
        Server ODBC driver. None if pyodbc/driver unavailable."""
        try:
            import pyodbc
        except ImportError:
            return None
        installed = [d for d in pyodbc.drivers() if "SQL Server" in d]
        if self.db_driver_odbc and self.db_driver_odbc in installed:
            return self.db_driver_odbc
        pref = ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server",
                "ODBC Driver 13 for SQL Server", "ODBC Driver 11 for SQL Server",
                "SQL Server Native Client 11.0", "SQL Server"]
        for d in pref:
            if d in installed:
                return d
        return installed[0] if installed else None

    def _server_spec(self) -> str:
        # Named instance ("host\inst") is resolved by SQL Browser, so no port.
        if "\\" in self.db_server or not self.db_port:
            return self.db_server
        return f"{self.db_server},{self.db_port}"

    @property
    def _pyodbc_url(self) -> URL:
        driver = self._odbc_driver()
        if driver is None:
            raise RuntimeError("pyodbc or an ODBC SQL Server driver is not installed")
        pwd = "{" + self.db_password.replace("}", "}}") + "}"
        conn = (
            f"DRIVER={{{driver}}};SERVER={self._server_spec()};DATABASE={self.db_name};"
            f"UID={self.db_user};PWD={pwd};"
            f"TrustServerCertificate={self.db_trust_cert};"
        )
        return URL.create("mssql+pyodbc", query={"odbc_connect": conn})

    @property
    def _pymssql_url(self) -> URL:
        # Fallback only: bundled FreeTDS can fail the TLS handshake on servers
        # that enforce encryption. URL.create escapes special characters in
        # the password safely.
        return URL.create(
            "mssql+pymssql", username=self.db_user, password=self.db_password,
            host=self.db_server, port=None if "\\" in self.db_server else self.db_port,
            database=self.db_name,
        )

    @property
    def sqlalchemy_url(self) -> URL:
        """The single URL for `db_engine` as configured — used when a
        caller wants one specific dialect (e.g. mysql dev mode). For the
        real SQL Server target, prefer `sqlalchemy_url_candidates` so
        pyodbc is tried first with an automatic pymssql fallback."""
        if self.db_engine == "mysql":
            return URL.create("mysql+pymysql", username=self.db_user, password=self.db_password,
                              host=self.db_server, port=self.db_port, database=self.db_name,
                              query={"charset": "utf8mb4"})
        if self.db_engine == "pyodbc":
            return self._pyodbc_url
        return self._pymssql_url

    @property
    def sqlalchemy_url_candidates(self) -> list[tuple[str, URL]]:
        """`[(driver_name, url), ...]` in the order to try connecting.
        SQL Server targets always try pyodbc first (needs the ODBC Driver
        installed — the newest installed driver is auto-detected) and
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

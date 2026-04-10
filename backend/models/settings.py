from sqlalchemy import Column, String, Text
from ..core.database import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    key = Column(String(128), primary_key=True)
    value = Column(Text, nullable=True)

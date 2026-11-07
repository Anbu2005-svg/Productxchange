from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    college: Optional[str] = None
    phone: Optional[str] = None
    is_verified: bool
    is_admin: bool = False
    avg_rating: float
    rating_count: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_radius_pref_km: int


class PublicUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    college: Optional[str] = None
    is_verified: bool
    avg_rating: float
    rating_count: int


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    full_name: Optional[str] = Field(None, max_length=100)
    college: Optional[str] = Field(None, max_length=150)

    @field_validator("full_name", "college", mode="before")
    @classmethod
    def sanitize_strings(cls, v):
        if isinstance(v, str):
            from app.core.security import sanitize_text
            return sanitize_text(v)
        return v


import bleach
from typing import Optional

# Allowed HTML tags for message content
ALLOWED_TAGS = [
    'b', 'i', 'u', 's', 'code', 'pre', 'a', 'br'
]

ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title'],
}


def sanitize_html(content: Optional[str]) -> Optional[str]:
    """
    Sanitize HTML content to prevent XSS attacks.

    Allows only safe formatting tags.
    """
    if content is None:
        return None

    return bleach.clean(
        content,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True
    )


def sanitize_text(content: Optional[str]) -> Optional[str]:
    """
    Remove all HTML tags from content.

    Use for fields that shouldn't contain any HTML.
    """
    if content is None:
        return None

    return bleach.clean(content, tags=[], strip=True)

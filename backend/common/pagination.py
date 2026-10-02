from rest_framework.pagination import CursorPagination, PageNumberPagination


class BoundedPageNumberPagination(PageNumberPagination):
    """
    Rule P2: Keep every list response paginated (max 50 rows) and under ~30 KB.
    """

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 50


class BoundedCursorPagination(CursorPagination):
    """
    Rule P2 & P3: O(log N) indexed cursor pagination without COUNT(*) overhead.
    """

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 50
    ordering = "-created_at"

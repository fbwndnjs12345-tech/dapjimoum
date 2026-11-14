from pathlib import Path
from pglast import parse_sql

paths = sorted(Path("supabase/migrations").glob("20261114*.sql"))
v2 = [path for path in paths if any(marker in path.name for marker in (
    "120000_answer_search_v2",
    "121000_answer_search_scheduler",
    "122000_admin_role_permissions",
    "123000_answer_search_global_rate_limit",
    "124000_answer_link_health_fields",
    "125000_answer_candidate_match_scoring",
    "126000_search_priority_engine",
))]
assert len(v2) == 7, f"Expected seven V2 migrations, found {len(v2)}"
for path in v2:
    sql = path.read_text(encoding="utf-8")
    parse_sql(sql)
    print(f"SQL syntax OK: {path}")
print("All V2 migration statements parsed successfully.")

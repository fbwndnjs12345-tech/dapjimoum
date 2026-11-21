-- Candidate approval/rejection is restricted to the explicit review permission.
INSERT INTO public.admin_role_permissions (role_key, permission_key)
VALUES ('super_admin', 'candidates.review'), ('reviewer', 'candidates.review')
ON CONFLICT (role_key, permission_key) DO NOTHING;

REVOKE ALL ON FUNCTION public.approve_answer_link_candidate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_answer_link_candidate(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_answer_link_candidate(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_answer_link_candidate(uuid, text) TO authenticated;

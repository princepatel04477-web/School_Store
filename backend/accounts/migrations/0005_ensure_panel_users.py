from django.db import migrations
from django.contrib.auth.hashers import make_password


def seed_panel_users(apps, schema_editor):
    User = apps.get_model('accounts', 'User')

    # 1. 9727746787 - Boss
    user, _ = User.objects.get_or_create(
        username='9727746787',
        defaults={
            'phone': '9727746787',
            'email': 'boss9727746787@schoolstore.in',
            'first_name': 'Boss',
            'last_name': 'User',
            'role': 'BOSS',
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
            'must_change_password': False,
        }
    )
    user.phone = '9727746787'
    user.role = 'BOSS'
    user.is_staff = True
    user.is_superuser = True
    user.is_active = True
    user.must_change_password = False
    user.password = make_password('Password@123')
    user.save()

    # 2. 9106139666 - Boss
    user, _ = User.objects.get_or_create(
        username='9106139666',
        defaults={
            'phone': '9106139666',
            'email': 'boss9106139666@schoolstore.in',
            'first_name': 'Boss',
            'last_name': 'User',
            'role': 'BOSS',
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
            'must_change_password': False,
        }
    )
    user.phone = '9106139666'
    user.role = 'BOSS'
    user.is_staff = True
    user.is_superuser = True
    user.is_active = True
    user.must_change_password = False
    user.password = make_password('Password@123')
    user.save()

    # 3. 6352438785 - Admin
    user, _ = User.objects.get_or_create(
        username='6352438785',
        defaults={
            'phone': '6352438785',
            'email': 'admin6352438785@schoolstore.in',
            'first_name': 'City',
            'last_name': 'Admin',
            'role': 'ADMIN',
            'is_staff': True,
            'is_superuser': False,
            'is_active': True,
            'must_change_password': False,
        }
    )
    user.phone = '6352438785'
    user.role = 'ADMIN'
    user.is_staff = True
    user.is_superuser = False
    user.is_active = True
    user.must_change_password = False
    user.password = make_password('Password@123')
    user.save()

    # Also ensure baseline accounts exist
    defaults = [
        ('boss', '9800000001', 'BOSS', True, True),
        ('admin_surat', '9800000002', 'ADMIN', True, False),
        ('school_admin_dps', '9800000003', 'SCHOOL_ADMIN', False, False),
    ]
    for uname, phone, role, is_staff, is_super in defaults:
        u, _ = User.objects.get_or_create(
            username=uname,
            defaults={
                'phone': phone,
                'email': f'{uname}@schoolstore.in',
                'role': role,
                'is_staff': is_staff,
                'is_superuser': is_super,
                'is_active': True,
                'must_change_password': False,
            }
        )
        u.phone = phone
        u.role = role
        u.is_staff = is_staff
        u.is_superuser = is_super
        u.is_active = True
        u.must_change_password = False
        u.password = make_password('Password@123')
        u.save()


def unseed_panel_users(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0004_user_branch_user_idx_user_role_branch'),
    ]

    operations = [
        migrations.RunPython(seed_panel_users, unseed_panel_users),
    ]

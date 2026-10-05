from rest_framework import serializers

from accounts.models import User
from schools.models import City


class BossAdminSerializer(serializers.ModelSerializer):
    """
    Boss-side Admin management: create a City Admin and assign them to a
    city, reassign cities later, deactivate accounts.
    """

    password = serializers.CharField(write_only=True, required=False, min_length=8)
    city = serializers.PrimaryKeyRelatedField(queryset=City.objects.all())
    city_name = serializers.CharField(source="city.name", read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "password",
            "first_name",
            "last_name",
            "email",
            "phone",
            "role",
            "city",
            "city_name",
            "is_active",
            "must_change_password",
            "created_at",
        )
        read_only_fields = ("id", "role", "created_at")

    def validate(self, attrs):
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError(
                {"password": "A password is required when creating an Admin."}
            )
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["role"] = User.Role.ADMIN
        validated_data["must_change_password"] = True
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
            instance.must_change_password = True
        instance.save()
        return instance

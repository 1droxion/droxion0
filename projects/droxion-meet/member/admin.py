from django.contrib import admin

from .models import Connection, Plan, Profile, Report

admin.site.site_header = "Droxion Meet · Private QA moderation"


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ("id", "category", "subject", "created", "resolved")
    list_filter = ("resolved", "category")
    readonly_fields = ("reporter", "subject", "category", "details", "evidence", "created")

    def has_add_permission(self, request):
        return False


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("name", "intention", "visible", "tier")
    readonly_fields = ("user", "name", "bio", "interests", "intention", "community")

    def has_add_permission(self, request):
        return False


class MetricsAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Connection)
class ConnectionAdmin(MetricsAdmin):
    list_display = ("id", "matched", "blocked", "closed")
    list_filter = ("low_likes", "high_likes", "blocked", "closed")


@admin.register(Plan)
class PlanAdmin(MetricsAdmin):
    list_display = ("id", "category", "status")
    list_filter = ("status", "category")
    fields = ("category", "status")

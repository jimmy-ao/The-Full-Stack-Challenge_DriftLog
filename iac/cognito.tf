# cognito

resource "aws_cognito_user_pool" "main" {
  name = local.cognito_user_pool_name

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your DriftLog bearing code"
    email_message        = "Welcome to DriftLog. Your confirmation code is {####}"
  }

  # Default Cognito email sending is capped at ~50 messages/day. Fine for a
  # demo; swap in SES here before anything resembling real traffic.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  deletion_protection = "INACTIVE"
}

resource "aws_cognito_user_pool_client" "web" {
  name         = local.cognito_user_pool_client_name
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 60 # minutes
  id_token_validity      = 60 # minutes
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
}

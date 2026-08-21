# locals

locals {
  env = substr(var.environment, 0, 1)

  region_main = join("", [element((split("-", var.region_main)), 0), substr(element((split("-", var.region_main)), 1), 0, 1), element((split("-", var.region_main)), 2)])
  region_alt  = join("", [element((split("-", var.region_alt)), 0), substr(element((split("-", var.region_alt)), 1), 0, 1), element((split("-", var.region_alt)), 2)])

  app         = var.app
  name_unique = "${var.app}-${random_id.suffix.hex}"

  account_id = data.aws_caller_identity.current.account_id

  #   api gateway

  api_routes = [
    "GET /pins",
    "POST /pins",
    "DELETE /pins/{sk}",
    "GET /patterns",
  ]

  #   cognito
  cognito_domain                = "${var.app}-${var.environment}-auth"
  cognito_user_pool_name        = join("", [local.env, "cog", local.region_main, var.app, "user-pool"])
  cognito_user_pool_client_name = join("", [local.env, "cog", local.region_main, var.app, "user-pool-client"])

  #   dynamodb
  dynamodb_table = join("", [local.env, "ddb", local.region_main, var.app, "table-pins"])

  # cloudwatch
  cloudwatch_log_group_api_name = join("", [local.env, "cwl", local.region_main, var.app, "api"])

  # iam
  iam_role_api_name   = join("", [local.env, "iam", local.region_main, var.app, "role-api"])
  iam_policy_api_name = join("", [local.env, "iam", local.region_main, var.app, "policy-api"])

  #   lambda
  lambda_function_api_name = join("", [local.env, "lbd", local.region_main, var.app, "api"])

}
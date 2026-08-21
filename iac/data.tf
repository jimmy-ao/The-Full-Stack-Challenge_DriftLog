# data

data "aws_region" "main" {}

data "aws_caller_identity" "current" {}

# lambda

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/src"
  output_path = "${path.module}/.terraform-build/api.zip"
}

data "aws_iam_policy_document" "api" {
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  statement {
    sid    = "PinsTable"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:DeleteItem",
    ]
    resources = [aws_dynamodb_table.pins.arn]
  }
}

